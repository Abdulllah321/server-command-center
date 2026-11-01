# Contributing to Server Command Center

### Powered by [Falah Tech](https://falah-tech.com)

Thank you for your interest in contributing to **Server Command Center**! To maintain enterprise stability, cryptographic security, and code quality, all contributions must adhere to the standards outlined below.

---

## 🏗️ Development Setup

### 1. Prerequisites
- **Node.js**: v20.x or v24.x (`node --version`)
- **Rust Toolchain**: 1.80+ stable (`rustc --version`, `cargo --version`)
- **C++ Compiler**: Visual Studio 2022+ C++ Build Tools (Windows MSVC)
- **Git**: Configured with line endings (`git config --global core.autocrlf true`)

### 2. Initial Setup
```powershell
# Clone the repository
git clone https://github.com/Abdulllah321/server-command-center.git
cd server-command-center

# Install frontend dependencies
npm install

# Run frontend + Rust backend in dev mode
npm run tauri dev
```

---

## 📐 Architecture Standards

### 1. Tauri Command Pattern
Every IPC command exposed between the Rust backend and React frontend must follow the 5-layer pipeline:

1. **Rust Implementation**:
   - Reside in `src-tauri/src/commands/<subsystem>.rs`.
   - Take `tauri::State<AppState>` and typed arguments.
   - Return `Result<T, CommandError>`.
   - Wrap any sensitive secret variables in `zeroize::Zeroizing::new(...)`.
2. **Registration**:
   - Register in `src-tauri/src/commands/mod.rs` and export via `pub use ...`.
   - Register inside `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
3. **Permissions & Capabilities**:
   - Check `src-tauri/capabilities/default.json` to ensure the command is permitted under the core IPC allowlist.
4. **TypeScript DTO Definitions**:
   - Define exact interface matching the Rust struct in `src/types/index.ts`.
5. **Client IPC Wrapper**:
   - Export a typed wrapper in `src/lib/tauri-client.ts` calling `invoke('<command_name>', args)`.

### 2. Frontend Conventions
- **React 19 & Hooks**: Use functional components with hooks.
- **Styling**: Tailwind CSS v4 utility classes. Prefer semantic CSS variables defined in `@theme` (`border-border`, `bg-card`, `text-muted-foreground`).
- **Responsive Layout**: Always verify that components adapt gracefully to mobile screens:
  - Use `h-[100dvh]` for full-screen viewports instead of `h-screen`.
  - Maintain $\ge 40\text{px}$ minimum touch height on buttons.
  - Test with mobile drawer navigation (`useUiStore.mobileMenuOpen`) and bottom nav (`MobileBottomNav.tsx`).
- **State Management**:
  - Global UI and layout state $\to$ Zustand (`src/stores/`).
  - Remote server data & caching $\to$ TanStack React Query (`@tanstack/react-query`).

---

## 🔒 Security & Secrets Checklist

All pull requests dealing with credentials, SSH keys, terminal commands, or server outputs must comply with the **Security Checklist**:

- [ ] **No Secrets in Logs**: Never log passwords, private keys, session tokens, or API secrets with `println!`, `eprintln!`, `dbg!`, or `console.log`.
- [ ] **Manual Debug Formatting**: Any struct containing credential fields must implement a manual `std::fmt::Debug` that replaces secret values with `"[REDACTED]"`.
- [ ] **Memory Zeroization**: Use `Zeroizing<String>` or `ZeroizeOnDrop` for all plaintext secrets in memory so they are securely wiped when dropped.
- [ ] **Stream Sanitization**: Output captured from remote execution (PTY, PM2, shell commands) must pass through `crate::secrets::redact::redact_secrets` before emission over IPC or storage in SQLite.
- [ ] **Host Key Verification**: Every SSH connection must verify and pin the remote server's host key against the local database to eliminate MITM vectors.

---

## 🧪 Verification & Pre-Commit Checks

Before opening a pull request, run the following verification checks:

```powershell
# 1. Typecheck TypeScript
npm run typecheck

# 2. Lint frontend code
npm run lint

# 3. Verify Vite bundle
npm run build

# 4. Run Rust unit & integration tests
cargo test --manifest-path src-tauri/Cargo.toml
```

All 4 checks must pass with **0 errors**.

---

## 🤝 Pull Request Guidelines

1. Create a feature branch from `master` (`git checkout -b feat/my-new-feature`).
2. Keep commits atomic and semantic:
   - `feat(...)`: New user-facing functionality.
   - `fix(...)`: Bug fix or layout correction.
   - `perf(...)`: Performance optimization.
   - `sec(...)`: Security hardening or vulnerability remediation.
   - `docs(...)`: Documentation updates.
3. Open a Pull Request on GitHub with a clear description of the problem solved, testing steps, and screenshots for UI changes.

