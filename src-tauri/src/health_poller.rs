use crate::error::CommandError;
use russh::client::Handle;
use crate::ssh::client::SshClientHandler;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSnapshot {
    pub cpu_pct: f32,
    pub ram_pct: f32,
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub swap_pct: f32,
    pub disk_pct: f32,
    pub disk_used_gb: f32,
    pub disk_total_gb: f32,
    pub load_avg: (f32, f32, f32),
    pub uptime_seconds: u64,
}

pub async fn fetch_health_snapshot(
    session: &mut Handle<SshClientHandler>,
) -> Result<HealthSnapshot, CommandError> {
    let script = r#"
export LC_ALL=C
cat /proc/stat | grep '^cpu '
sleep 0.5
cat /proc/stat | grep '^cpu '
free -b | awk 'NR==2{print $2,$3} NR==3{print $2,$3}'
df -B1 / | awk 'NR==2{print $2,$3}'
cat /proc/loadavg
cat /proc/uptime | awk '{print $1}'
"#;

    // Open an exec channel
    let mut channel = session.channel_open_session().await
        .map_err(|e| CommandError::Internal(format!("Failed to open SSH channel: {}", e)))?;

    channel.exec(true, script).await
        .map_err(|e| CommandError::Internal(format!("Failed to exec health script: {}", e)))?;

    let mut output = String::new();

    let timeout_duration = Duration::from_secs(5);
    
    // Read the stream
    loop {
        let msg_future = channel.wait();
        let msg_opt = match timeout(timeout_duration, msg_future).await {
            Ok(opt) => opt,
            Err(_) => {
                let _ = channel.close().await;
                return Err(CommandError::Internal("Health poll script timed out".into()));
            }
        };

        match msg_opt {
            Some(ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                break;
            }
            _ => {}
        }
    }

    let _ = channel.close().await;
    parse_health_snapshot(&output)
}

fn parse_health_snapshot(output: &str) -> Result<HealthSnapshot, CommandError> {
    let lines: Vec<&str> = output.trim().lines().filter(|l| !l.trim().is_empty()).collect();
    
    // We expect at least 6 lines: cpu1, cpu2, ram, (optional swap), disk, load, uptime
    // Wait, free -b output: RAM is line 3, Swap is line 4 (if swap exists)
    // Actually, `free -b | awk 'NR==2{print $2,$3} NR==3{print $2,$3}'` prints:
    // [ram_total] [ram_used]
    // [swap_total] [swap_used]
    // If no swap, the second line might be empty or missing.
    // Let's iterate carefully.

    if lines.len() < 5 {
        return Err(CommandError::Internal(format!("Malformed health output: not enough lines. Output:\n{}", output)));
    }

    let parse_f32 = |s: &str| s.parse::<f32>().unwrap_or(0.0);
    let parse_u64 = |s: &str| s.parse::<u64>().unwrap_or(0);

    // 1 & 2: CPU stats
    let cpu1_parts: Vec<&str> = lines[0].split_whitespace().collect();
    let cpu2_parts: Vec<&str> = lines[1].split_whitespace().collect();

    if cpu1_parts.len() < 5 || cpu2_parts.len() < 5 {
        return Err(CommandError::Internal("Malformed CPU output".into()));
    }

    // parts: cpu, user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice
    let sum_cpu = |parts: &[&str]| -> (u64, u64) {
        let idle = parse_u64(parts.get(4).unwrap_or(&"0")) + parse_u64(parts.get(5).unwrap_or(&"0"));
        let non_idle = parse_u64(parts.get(1).unwrap_or(&"0")) +
                       parse_u64(parts.get(2).unwrap_or(&"0")) +
                       parse_u64(parts.get(3).unwrap_or(&"0")) +
                       parse_u64(parts.get(6).unwrap_or(&"0")) +
                       parse_u64(parts.get(7).unwrap_or(&"0")) +
                       parse_u64(parts.get(8).unwrap_or(&"0"));
        (idle, idle + non_idle)
    };

    let (idle1, total1) = sum_cpu(&cpu1_parts);
    let (idle2, total2) = sum_cpu(&cpu2_parts);

    let total_diff = total2.saturating_sub(total1) as f32;
    let idle_diff = idle2.saturating_sub(idle1) as f32;
    let cpu_pct = if total_diff > 0.0 {
        ((total_diff - idle_diff) / total_diff) * 100.0
    } else {
        0.0
    };

    let mut line_idx = 2;

    // 3: RAM
    let ram_parts: Vec<&str> = lines[line_idx].split_whitespace().collect();
    if ram_parts.len() < 2 {
        return Err(CommandError::Internal("Malformed RAM output".into()));
    }
    let ram_total = parse_u64(ram_parts[0]);
    let ram_used = parse_u64(ram_parts[1]);
    let ram_pct = if ram_total > 0 { (ram_used as f32 / ram_total as f32) * 100.0 } else { 0.0 };
    line_idx += 1;

    // 4: Swap (optional, some systems don't have it, awk NR==3 might fail)
    // If the next line has 2 numbers and the line after has 2 numbers (df), then this is swap.
    let mut swap_pct = 0.0;
    
    // We can distinguish swap from disk by checking how many lines are left.
    // total expected: cpu1, cpu2, ram, [swap], disk, load, uptime
    // So if lines left from current index is 4, we have swap. If 3, no swap.
    let remaining = lines.len() - line_idx;
    if remaining == 4 {
        let swap_parts: Vec<&str> = lines[line_idx].split_whitespace().collect();
        if swap_parts.len() >= 2 {
            let swap_total = parse_u64(swap_parts[0]);
            let swap_used = parse_u64(swap_parts[1]);
            if swap_total > 0 {
                swap_pct = (swap_used as f32 / swap_total as f32) * 100.0;
            }
        }
        line_idx += 1;
    }

    // 5: Disk
    let disk_parts: Vec<&str> = lines[line_idx].split_whitespace().collect();
    if disk_parts.len() < 2 {
        return Err(CommandError::Internal("Malformed Disk output".into()));
    }
    let disk_total_b = parse_u64(disk_parts[0]);
    let disk_used_b = parse_u64(disk_parts[1]);
    let disk_total_gb = disk_total_b as f32 / 1_073_741_824.0;
    let disk_used_gb = disk_used_b as f32 / 1_073_741_824.0;
    let disk_pct = if disk_total_b > 0 { (disk_used_b as f32 / disk_total_b as f32) * 100.0 } else { 0.0 };
    line_idx += 1;

    // 6: Load Average
    let load_parts: Vec<&str> = lines[line_idx].split_whitespace().collect();
    if load_parts.len() < 3 {
        return Err(CommandError::Internal("Malformed Load Average output".into()));
    }
    let load_avg = (
        parse_f32(load_parts[0]),
        parse_f32(load_parts[1]),
        parse_f32(load_parts[2]),
    );
    line_idx += 1;

    // 7: Uptime
    let uptime_parts: Vec<&str> = lines[line_idx].split_whitespace().collect();
    if uptime_parts.is_empty() {
        return Err(CommandError::Internal("Malformed Uptime output".into()));
    }
    let uptime_seconds = parse_f32(uptime_parts[0]) as u64;

    Ok(HealthSnapshot {
        cpu_pct,
        ram_pct,
        ram_used_mb: ram_used / 1_048_576,
        ram_total_mb: ram_total / 1_048_576,
        swap_pct,
        disk_pct,
        disk_used_gb,
        disk_total_gb,
        load_avg,
        uptime_seconds,
    })
}
