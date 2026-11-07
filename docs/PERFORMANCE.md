# Reproducible performance checks

Build the production application, then run `npm --workspace @photo-manager/desktop run benchmark:reproducible -- 1000 test-results/performance-1000.json`.

Supported synthetic gallery sizes: 100, 1000, 3000, 5000. The benchmark checks duplicate-group integrity and event-loop yielding, 100 manual decisions plus undo, and twelve-month selection. It reports CPU timings and process memory. It does not measure physical disk scanning or establish parity on every device.

`npm --workspace @photo-manager/desktop run test:e2e` separately uses actual image files, native IPC, SQLite and the production renderer. Its evidence includes screenshots in all fifteen languages at two viewport sizes. Set `ALBUMDONE_ACCEPTANCE_EXE` to the exact packaged executable to verify the packaged runtime. These tests use a separate application data profile and synthetic photos.
