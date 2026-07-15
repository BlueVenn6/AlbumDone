# Reproducible Performance Benchmarks

AlbumDone includes a synthetic gallery generator and a production-Electron
benchmark. No private or user-owned photos are used or committed.

The generated galleries contain deterministic JPEG and PNG images, exact
duplicates, near-duplicate scenes, screenshot-shaped images, corrupt files,
large images, and images without EXIF metadata. Every run uses a temporary
directory and removes it afterward.

## July 2026 Baseline

These measurements were collected on Windows 11 using a Microsoft SQ2
8-core ARM64 device with 15.5 GB RAM. The current x64 Electron application ran
through Windows 11 x64 emulation. Times are wall-clock milliseconds. Peak
memory is the sampled aggregate working set of the Electron processes.

| Photos | First batch | Full scan | Culling first image | Auto Dedup | Screenshot filter | Year in Review | Peak memory |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 822 ms | 1,288 ms | 3,269 ms | 3,641 ms | 662 ms | 1,302 ms | 697 MB |
| 1,000 | 905 ms | 5,868 ms | 1,650 ms | 25,081 ms | 1,485 ms | 2,499 ms | 788 MB |
| 3,000 | 1,036 ms | 13,595 ms | 3,424 ms | 82,039 ms | 5,796 ms | 5,055 ms | 1,016 MB |
| 5,000 | 1,405 ms | 21,643 ms | 4,758 ms | 148,922 ms | 12,593 ms | 5,854 ms | 1,112 MB |

All four runs completed without an application crash or timeout. These are
synthetic baseline results, not a performance guarantee for every disk,
decoder, CPU, or photo collection.

## Run Locally

Build the production application first:

```powershell
npm --workspace @photo-manager/desktop run build
```

Run one of the supported sizes:

```powershell
npm --workspace @photo-manager/desktop run benchmark:reproducible -- 100 test-results/performance-100.json
npm --workspace @photo-manager/desktop run benchmark:reproducible -- 1000 test-results/performance-1000.json
npm --workspace @photo-manager/desktop run benchmark:reproducible -- 3000 test-results/performance-3000.json
npm --workspace @photo-manager/desktop run benchmark:reproducible -- 5000 test-results/performance-5000.json
```

CI runs the 100-photo benchmark on every push and pull request. The
`Reproducible performance benchmark` workflow supports manual 100, 1,000,
3,000, and 5,000-photo runs and performs a scheduled 1,000-photo run.
