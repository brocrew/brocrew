# Known clone identities

- `css|apps/desktop/src/renderer/src/components/EventStream.vue|apps/desktop/test/dom/event-fold-baseline.vue` — The independent DOM baseline must not import production styling, which would couple the oracle to the implementation.
- `css|apps/desktop/src/renderer/src/components/RecentActivity.vue|apps/desktop/src/renderer/src/components/SinceYouWereLastHere.vue` — This short reset and border sequence does not provide a coherent shared component for the two activity surfaces.
- `html|apps/desktop/src/renderer/src/components/PersonsQueue.vue|apps/desktop/src/renderer/src/components/PersonsQueue.vue` — The primary and secondary answer branches retain different conditions and accessibility bindings around this small markup.
- `typescript|apps/desktop/test/a-slow-provider-is-waited-for.test.ts|apps/desktop/test/reopen-while-closing.test.ts` — These independent runtime-host scenarios keep matching imports local so their setup dependencies remain explicit.
