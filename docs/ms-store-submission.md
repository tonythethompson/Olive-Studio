# Microsoft Store Submission Checklist

## Prerequisites

- [ ] Microsoft Partner Center account registered ($19 one-time individual / $99 company)
- [ ] App reservation: "Olive Studio" name reserved in Partner Center
- [ ] Privacy policy URL published and accessible (required for Store listing)

## Package Preparation

- [ ] MSIX bundle produced by CI (`tauri-build.yml` on `v*` tags)
- [ ] Package identity: `com.tonythethompson.olive-studio`
- [ ] Publisher: `CN=TonyThompson` (must match Partner Center certificate)
- [ ] Minimum OS version: Windows 10 1809 (10.0.17763.0)
- [ ] WebView2 runtime: downloadBootstrapper mode (auto-installs if missing)
- [ ] Package size < 200MB (current estimate: ~80MB with Node sidecar)

## Store Listing Assets

- [ ] App logo (300x300 PNG)
- [ ] Store screenshots (1366x768 minimum, 3-5 recommended)
  - [ ] Main workspace with pipeline configured
  - [ ] Batch processing with comparison view
  - [ ] Recipe graph visualization
  - [ ] Run history / export report
- [ ] Promotional image (1920x1080, optional)
- [ ] App description (short + long)
- [ ] Release notes for current version
- [ ] Category: Developer Tools > Software Development
- [ ] Keywords: olive, onnx, model optimization, machine learning, inference

## Submission Steps

1. Sign in to [Partner Center](https://partner.microsoft.com/dashboard)
2. Navigate to Apps & Games > Olive Studio
3. Create new submission
4. Upload MSIX bundle from CI artifacts
5. Complete listing: description, screenshots, category, pricing (Free)
6. Set availability: all markets (or select subset)
7. Content ratings questionnaire (IARC)
8. Privacy policy URL
9. Submit for certification

## Certification Expectations

- Typical review: 1-3 business days
- Common rejection reasons to preempt:
  - Missing privacy policy (even for local-only apps)
  - App crashes on launch (test MSIX on clean VM)
  - Incomplete listing metadata
  - WebView2 bootstrapper fails on LTSC (mitigated: offline installer fallback)

## Post-Submission

- [ ] Monitor certification status in Partner Center
- [ ] Address any rejection feedback within 48h
- [ ] After approval: verify auto-update works (Store handles natively)
- [ ] NSIS installer remains available on GitHub Releases for sideloading

## Distribution Strategy

| Channel         | Format | Signing                    | Auto-Update | Audience               |
| --------------- | ------ | -------------------------- | ----------- | ---------------------- |
| Microsoft Store | MSIX   | Store trust chain          | Native      | General users          |
| GitHub Releases | NSIS   | None (SmartScreen warning) | Manual      | Developers/sideloading |
| GitHub Releases | MSI    | None                       | Manual      | Enterprise/IT          |

## Cost Summary

| Item                        | Cost               | Frequency    |
| --------------------------- | ------------------ | ------------ |
| Partner Center registration | $19 (individual)   | One-time     |
| Code signing                | $0 (Store handles) | N/A          |
| Auto-update hosting         | $0 (Store handles) | N/A          |
| **Total**                   | **$19**            | **One-time** |
