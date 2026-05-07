# Security Policy

## Reporting a Vulnerability

If you find a security issue in uaip-locator, please **do not open a public GitHub issue**.

Email **security@uaip.dev** with:

- A description of the issue.
- Steps to reproduce.
- Affected versions.
- Your assessment of impact.

You'll get an acknowledgement within 72 hours and a remediation plan within 7 days. We coordinate disclosure with you and credit you in the release notes (unless you prefer anonymity).

## Supported Versions

The latest minor release on npm gets security fixes. Older minors are not patched — upgrade to stay supported.

## Scope

In scope:

- Code execution / sandbox escape during crawl
- Path traversal when writing emitted output
- Credential leakage in emitted artifacts (the OSS doesn't accept credentials, but generated code shouldn't surprise-leak environment variables)

Out of scope:

- Issues in `playwright` itself — report to the [Playwright project](https://github.com/microsoft/playwright/security)
- Issues in transitive npm dependencies — file with the upstream
- Vulnerabilities in the hosted UAIP SaaS — email security@uaip.dev separately
