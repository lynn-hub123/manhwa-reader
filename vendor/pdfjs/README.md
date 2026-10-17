# PDF.js local distribution

Upstream: Mozilla PDF.js / npm `pdfjs-dist@3.11.174` (Apache-2.0).

Tarball: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-3.11.174.tgz

Registry integrity (SHA-512, base64):
`TdTZPf1trZ8/UFu5Cx/GXB7GZM30LT+wWUNfsi6Bq8ePLnb+woNKtDymI2mxZYBpMbonNFqKmiz684DIfnd8dA==`

Only `build/pdf.min.js`, `build/pdf.worker.min.js`, and the upstream `LICENSE` are copied, unchanged. No npm runtime dependency or CDN is required.

This compatibility release is old. All application PDF entry points use `pdf-engine.js`, which forces `isEvalSupported: false`, the official workaround for CVE-2024-4367 / GHSA-wgrm-67xf-hhpq:
https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq

This mitigation is not a claim that all possible PDF.js issues are fixed. Upgrade to a supported patched distribution and re-run PDF/cover/worker/browser tests before public release.
