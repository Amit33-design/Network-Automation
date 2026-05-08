# NetDesign AI — Commercial License

## Tiers

| Feature                        | Community | Professional | Enterprise |
|-------------------------------|-----------|--------------|------------|
| Config generation              | ✓         | ✓            | ✓          |
| MCP tools (Claude integration) | ✓         | ✓            | ✓          |
| Network simulation             | ✓         | ✓            | ✓          |
| Policy engine & static analysis| ✓         | ✓            | ✓          |
| Device deployment (Nornir)     | —         | ✓            | ✓          |
| Zero Touch Provisioning (ZTP)  | —         | ✓            | ✓          |
| Backup & rollback              | —         | ✓            | ✓          |
| JWT RBAC auth                  | —         | ✓            | ✓          |
| Design persistence (DB)        | —         | ✓            | ✓          |
| RCA engine                     | —         | —            | ✓          |
| gNMI streaming telemetry       | —         | —            | ✓          |
| Audit log export               | —         | —            | ✓          |
| SSO / SAML                     | —         | —            | ✓          |
| White-label / OEM              | —         | —            | ✓          |
| Priority support               | —         | —            | ✓          |
| Max network devices            | 0         | 50           | Unlimited  |
| Price                          | Free      | Contact us   | Contact us |

## License Model

Each license key is:

- **Ed25519-signed** — keys cannot be forged or modified
- **Machine-bound** — tied to a Docker volume UUID (`/app/backups/.machine_id`)
  - Same Docker volume = same licensed instance
  - Deleting the volume requires re-activation
- **Offline** — no call-home required; validation is fully local
- **Optional expiry** — perpetual or date-bound subscriptions available

### Key Format

```
nd.<base64url(payload_json)>.<base64url(ed25519_signature)>
```

### Activation

1. Set `LICENSE_KEY=<your key>` in your `.env` file (or Docker env)
2. Restart the API container — the license is loaded at startup
3. Verify: `GET /api/license` returns your tier and features

### One Activation Per Instance

One license key activates **one Docker volume** (one running instance).
To run multiple instances, purchase a license per instance or contact us for a site license.

## Contact

To purchase or request a trial: **sales@netdesign.ai**  
For support: **support@netdesign.ai**

---

*NetDesign AI Community Edition is free to use under the Apache 2.0 license.*  
*Professional and Enterprise editions require a commercial license.*
