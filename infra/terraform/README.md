# Terraform (planned for v0.4)

Infrastructure-as-code arrives at v0.4 when production hosting moves from
"clicked through dashboards" to "reproducible from a script."

Until then, infrastructure is created manually via:
- Supabase dashboard (database + auth)
- Vercel dashboard (web frontend)
- Railway / Fly dashboard (API backend)
- Cloudflare dashboard (R2 + DNS)

The handoff to Terraform should happen when:
- More than one person is making infra changes, OR
- A second environment (staging) is needed, OR
- A school's data residency requirements force a region change

Until any of those is true, dashboards are faster.
