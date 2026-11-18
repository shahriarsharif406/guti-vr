# Spellforge release checklist

- [x] `npx tsc --noEmit` clean
- [x] `npm test` all passing
- [x] `npm run build` succeeds
- [x] Desktop Playwright e2e passing (`tests/spell-e2e.mjs`)
- [x] No console or page errors in e2e
- [x] Status docs honest (VERIFIED = NO everywhere)
- [ ] Headset smoke test on Quest (hand tracking, audio, comfort)  <- blocked: no headset
- [ ] Frame timing measured on headset  <- blocked: no headset
- [ ] SF-1 boss bar overlap fixed
- [ ] Hosted on a public HTTPS origin and opened from a headset browser
- [ ] Credits/licences reviewed (procedural audio only in Spellforge; shared Oculus Audio Pack samples are CC BY 4.0)
