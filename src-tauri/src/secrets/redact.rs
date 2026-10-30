use regex::Regex;
use std::sync::OnceLock;

static PEM_KEY_REGEX: OnceLock<Regex> = OnceLock::new();
static VEYRA_REF_REGEX: OnceLock<Regex> = OnceLock::new();
static API_TOKENS_REGEX: OnceLock<Regex> = OnceLock::new();
static BEARER_REGEX: OnceLock<Regex> = OnceLock::new();
static DB_URI_REGEX: OnceLock<Regex> = OnceLock::new();
static KEY_VALUE_SECRET_REGEX: OnceLock<Regex> = OnceLock::new();

pub fn redact_secrets(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }

    // 1. Redact PEM & SSH private key blocks (spanning newlines)
    let pem_re = PEM_KEY_REGEX.get_or_init(|| {
        Regex::new(r"(?s)(-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----.*?-----END[ A-Z0-9_-]*PRIVATE KEY-----|---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----.*?---- END SSH2 ENCRYPTED PRIVATE KEY ----|-----BEGIN EC PARAMETERS-----.*?-----END EC PARAMETERS-----)").unwrap()
    });
    let s1 = pem_re.replace_all(input, "***REDACTED_PRIVATE_KEY***");

    // 2. Redact internal Veyra credential / keychain references
    let ref_re = VEYRA_REF_REGEX.get_or_init(|| {
        Regex::new(r"\bscc:(?:credential|test):[a-zA-Z0-9_-]+\b").unwrap()
    });
    let s2 = ref_re.replace_all(&s1, "***REDACTED_CREDENTIAL_REF***");

    // 3. Redact common cloud / git tokens (AWS AKIA, GitHub PAT/OAuth)
    let tokens_re = API_TOKENS_REGEX.get_or_init(|| {
        Regex::new(r"\b(AKIA[0-9A-Z]{16}|gh[pousr]_[0-9a-zA-Z]{36,}|github_pat_[0-9a-zA-Z_]{82})\b").unwrap()
    });
    let s3 = tokens_re.replace_all(&s2, "***REDACTED_API_TOKEN***");

    // 4. Redact Bearer tokens
    let bearer_re = BEARER_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(bearer\s+)[a-zA-Z0-9_\-\.]{20,}\b").unwrap()
    });
    let s4 = bearer_re.replace_all(&s3, "${1}***REDACTED_TOKEN***");

    // 5. Redact passwords in connection URLs (e.g. postgres://user:pass@host/db)
    let db_uri_re = DB_URI_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b((?:postgres(?:ql)?|mysql|redis|mongodb|amqp|mssql)://[^:\s]+:)([^@\s]+)(@)").unwrap()
    });
    let s5 = db_uri_re.replace_all(&s4, "${1}***REDACTED_PASSWORD***${3}");

    // 6. Redact password/secret key-value patterns (e.g. password=secret, "secret_key": "val")
    let kv_re = KEY_VALUE_SECRET_REGEX.get_or_init(|| {
        Regex::new(r#"(?i)\b(password|passwd|pwd|api_key|apikey|secret_key|auth_token)\s*([:=])\s*(['"]?)[^\s'",;\r\n]{4,}(['"]?)"#).unwrap()
    });
    let s6 = kv_re.replace_all(&s5, "${1}${2}${3}***REDACTED***${4}");

    s6.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_pem_private_keys() {
        let rsa_key = "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\n+dummy_key_material\n-----END RSA PRIVATE KEY-----\nafter";
        let redacted = redact_secrets(rsa_key);
        assert!(!redacted.contains("dummy_key_material"));
        assert!(redacted.contains("***REDACTED_PRIVATE_KEY***"));
        assert!(redacted.contains("before"));
        assert!(redacted.contains("after"));

        let openssh_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\n-----END OPENSSH PRIVATE KEY-----";
        assert_eq!(redact_secrets(openssh_key), "***REDACTED_PRIVATE_KEY***");
    }

    #[test]
    fn test_redact_credential_refs() {
        let text = "Loading credential scc:credential:1234-5678-abcd for host";
        let redacted = redact_secrets(text);
        assert_eq!(redacted, "Loading credential ***REDACTED_CREDENTIAL_REF*** for host");
    }

    #[test]
    fn test_redact_tokens() {
        let gh_token = "export GITHUB_TOKEN=ghp_123456789012345678901234567890123456";
        let redacted = redact_secrets(gh_token);
        assert!(!redacted.contains("123456789012345678901234567890123456"));
        assert!(redacted.contains("***REDACTED_API_TOKEN***"));

        let aws_key = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
        assert_eq!(redact_secrets(aws_key), "AWS_ACCESS_KEY_ID=***REDACTED_API_TOKEN***");
    }

    #[test]
    fn test_redact_bearer_tokens() {
        let header = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
        let redacted = redact_secrets(header);
        assert!(!redacted.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
        assert!(redacted.contains("Bearer ***REDACTED_TOKEN***"));
    }

    #[test]
    fn test_redact_database_urls() {
        let conn_str = "DATABASE_URL=postgres://app_user:super_secret_db_pass_123@db.internal:5432/production";
        let redacted = redact_secrets(conn_str);
        assert!(!redacted.contains("super_secret_db_pass_123"));
        assert_eq!(redacted, "DATABASE_URL=postgres://app_user:***REDACTED_PASSWORD***@db.internal:5432/production");

        let redis_str = "REDIS_URL=redis://default:my_redis_auth_pass@cache.internal:6379";
        let redacted_redis = redact_secrets(redis_str);
        assert!(!redacted_redis.contains("my_redis_auth_pass"));
        assert_eq!(redacted_redis, "REDIS_URL=redis://default:***REDACTED_PASSWORD***@cache.internal:6379");
    }

    #[test]
    fn test_redact_key_value_secrets() {
        let env_line = "password=SuperSecretPassword123\napi_key=\"my_api_key_value\"";
        let redacted = redact_secrets(env_line);
        assert!(!redacted.contains("SuperSecretPassword123"));
        assert!(!redacted.contains("my_api_key_value"));
        assert!(redacted.contains("password=***REDACTED***"));
        assert!(redacted.contains("api_key=\"***REDACTED***\""));
    }
}
