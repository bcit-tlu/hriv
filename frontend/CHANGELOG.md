# Changelog

## [0.8.0](https://github.com/bcit-tlu/hriv/compare/frontend-v0.7.1...frontend-v0.8.0) (2026-04-22)


### Features

* **version:** split build-identity from display-identity; inject APP_VERSION via Helm ([#197](https://github.com/bcit-tlu/hriv/issues/197)) ([c20730a](https://github.com/bcit-tlu/hriv/commit/c20730adf04497bd52f599e7476b01003c9f937f))


### Bug Fixes

* show error toast on image delete failure ([#192](https://github.com/bcit-tlu/hriv/issues/192)) ([75ab7fb](https://github.com/bcit-tlu/hriv/commit/75ab7fb92aacaa7f2eb9c3659088432eba2d98c3))

## [0.7.1](https://github.com/bcit-tlu/hriv/compare/frontend-v0.7.0...frontend-v0.7.1) (2026-04-21)


### Bug Fixes

* **release:** switch to language-specific release types ([#179](https://github.com/bcit-tlu/hriv/issues/179)) ([1ebba10](https://github.com/bcit-tlu/hriv/commit/1ebba106d1ed743087aea2f0f7a3b9905f07af81))

## [0.7.0](https://github.com/bcit-tlu/hriv/compare/frontend-v0.6.0...frontend-v0.7.0) (2026-04-21)


### Features

* **frontend:** add 'follow OS' option to theme toggle ([#153](https://github.com/bcit-tlu/hriv/issues/153)) ([e928df6](https://github.com/bcit-tlu/hriv/commit/e928df6b051da0914f2528133213a881bbf0deba))


### Bug Fixes

* **release:** correct extra-files paths in release-please config ([#163](https://github.com/bcit-tlu/hriv/issues/163)) ([3a788ac](https://github.com/bcit-tlu/hriv/commit/3a788ac287f40a45c0146fcc21555ea65179105b))
* **release:** reset manifest to last stable version for clean 0.7.0 graduation ([#176](https://github.com/bcit-tlu/hriv/issues/176)) ([2c0d2fc](https://github.com/bcit-tlu/hriv/commit/2c0d2fc0d65885b46741689147aa7e751976747e))
* **release:** use rc1 prerelease format instead of rc.1 ([#166](https://github.com/bcit-tlu/hriv/issues/166)) ([277045b](https://github.com/bcit-tlu/hriv/commit/277045b79fdbc652ba1b9864de5fa0f591af324f))
* remove unused release graduation markers to trigger stable releases ([#173](https://github.com/bcit-tlu/hriv/issues/173)) ([b59d14a](https://github.com/bcit-tlu/hriv/commit/b59d14a5fcb8a315d095641302b565f94283faf9))

## [0.7.0-rc2](https://github.com/bcit-tlu/hriv/compare/frontend-v0.7.0-rc1...frontend-v0.7.0-rc2) (2026-04-21)


### Features

* add confirmation dialog for View Image when form has unsaved changes ([f19093b](https://github.com/bcit-tlu/hriv/commit/f19093b5af0e17ec0c6913dbd8ff15dcbc818ba7))
* add dark mode toggle with customizable color palettes ([b5a71e1](https://github.com/bcit-tlu/hriv/commit/b5a71e1b282c1005ac1259ecdf8de5c5cbd0c4b2))
* add delete confirmation dialog to Images tab row action ([fbb5a1a](https://github.com/bcit-tlu/hriv/commit/fbb5a1a868ace51cf363c140c76273c24ccfae60))
* add drag-and-drop reordering to Manage Categories dialog ([444ec21](https://github.com/bcit-tlu/hriv/commit/444ec21c30df24370d44eada69b60518d64a6b83))
* add image processing progress indicator and auto-refresh ([5fd9592](https://github.com/bcit-tlu/hriv/commit/5fd9592c140c4a327aa7282bf4e5e35f206f5c0e))
* add lightweight canvas overlay for image annotations ([8bf18ab](https://github.com/bcit-tlu/hriv/commit/8bf18abbe081a120e59d30433c1e89bbaf55d7f2))
* add lock/unlock overlay persistence with role-based access ([c047be7](https://github.com/bcit-tlu/hriv/commit/c047be77ce1fb40e53a02810aab5e05778f71408))
* add processing progress percentage to snackbar ([5c7197b](https://github.com/bcit-tlu/hriv/commit/5c7197b3b0c5f04058f39f23a134a4bda2b83d09))
* add task cancellation with cancel button in UI ([1a60d7d](https://github.com/bcit-tlu/hriv/commit/1a60d7dfc79b90de07f7b69510f8e4128d15f339))
* add View link in snackbar after successful image upload/process ([f608b61](https://github.com/bcit-tlu/hriv/commit/f608b61a6f6086ca2a5470ada267ee3c681f978a))
* add visual indicator for inactive images on card tiles ([cadce50](https://github.com/bcit-tlu/hriv/commit/cadce5053dd10519cc366777c6fb5f45d019ecc4))
* **admin:** auto-scroll log viewer, byte-based export progress, force-cancel fix ([3a4d240](https://github.com/bcit-tlu/hriv/commit/3a4d24095b96f1ad0c6dfef963d24a83c5e702c2))
* **admin:** confirm destructive import before firing API call (P18) ([212bc7f](https://github.com/bcit-tlu/hriv/commit/212bc7f3cec68addc9d42499df550db18f1fc8ed))
* **admin:** expose force-cancel in the UI for tasks stuck in 'cancelling' ([abf8cfe](https://github.com/bcit-tlu/hriv/commit/abf8cfe59f5c5a9f087e6682ecd57b67d7b355f3))
* arrow styles, line thickness, fill/outline, text save fix, debug logging ([8384c56](https://github.com/bcit-tlu/hriv/commit/8384c56691a190b8400bc05cee6a3127496e71f6))
* center-crop card thumbnails for recognisable image previews ([#140](https://github.com/bcit-tlu/hriv/issues/140)) ([ec9f31c](https://github.com/bcit-tlu/hriv/commit/ec9f31c3db00de849c66765b74c081794d6225df))
* **ci:** automated CI/CD pipeline with Release Please, OCI Helm charts, and Flux GitOps ([eb0657e](https://github.com/bcit-tlu/hriv/commit/eb0657ea802ff9ac94c4ec028da8a201088d56ab))
* **ci:** switch to per-component Release Please packages for independent versioning ([de8ff81](https://github.com/bcit-tlu/hriv/commit/de8ff8108da1d4a8af08cc4017de251435d700ba))
* decouple admin import/export into background tasks with snackbar notifications ([374a197](https://github.com/bcit-tlu/hriv/commit/374a197318125f062b5ee214b964935cffc8b80a))
* display image dimensions and file size on image cards ([8f1b244](https://github.com/bcit-tlu/hriv/commit/8f1b2447e5981d1bcb14929e503ffed2b4790365))
* ensure cursor focus in new category name field via ref + onEntered ([891490d](https://github.com/bcit-tlu/hriv/commit/891490d0d3ab96e1281a8256d8cf4792b0902ba0))
* frontend tweaks - View Image button, category auto-select, table cleanup, footer link ([9f4c6a5](https://github.com/bcit-tlu/hriv/commit/9f4c6a50d113a8009015f1b9aaa6d2d90d2001cb))
* **frontend:** add 'follow OS' option to theme toggle ([#153](https://github.com/bcit-tlu/hriv/issues/153)) ([e928df6](https://github.com/bcit-tlu/hriv/commit/e928df6b051da0914f2528133213a881bbf0deba))
* **frontend:** add forgot password modal to login form ([8ab7bc0](https://github.com/bcit-tlu/hriv/commit/8ab7bc0bdb19ca53255a496eea5b25b022c622f6))
* **frontend:** add login field labels for username and password ([242a69c](https://github.com/bcit-tlu/hriv/commit/242a69cae580bf7f7a17dcdd3ae8ad00995f9c89))
* **frontend:** update login splash image with attribution overlay ([46ae915](https://github.com/bcit-tlu/hriv/commit/46ae9156ecd7acfc9e97ca76cbb113d131f591e2))
* **frontend:** update login splash with attribution and add field labels ([e28c242](https://github.com/bcit-tlu/hriv/commit/e28c242459e0ffa14763c64870b0081045466cc3))
* **frontend:** use hriv splash image and remove login attribution overlay ([850a4da](https://github.com/bcit-tlu/hriv/commit/850a4da9f72583574b966bb3b479208a379a1791))
* gate footer versions to admins and surface per-component versions ([#149](https://github.com/bcit-tlu/hriv/issues/149)) ([#150](https://github.com/bcit-tlu/hriv/issues/150)) ([b3447dd](https://github.com/bcit-tlu/hriv/commit/b3447dd997a419485b17804b8823d0b0d3c06fda))
* granular progress tracking via pyvips eval signals and status messages ([571b268](https://github.com/bcit-tlu/hriv/commit/571b268fddf9340b138b310fc8bdbf7d72ac57be))
* increase share view overlay limit from 5 to 10 ([b23dd52](https://github.com/bcit-tlu/hriv/commit/b23dd525a7fb04a13389703c01aa2c31d22db839))
* mirror Add Image fields in Bulk Import modal via shared ImageMetadataFields component ([6a73c6b](https://github.com/bcit-tlu/hriv/commit/6a73c6bd65cfa7467bbb789ae234f53a3ac53fa8))
* persist search query and filters across modal open/close cycles ([7697062](https://github.com/bcit-tlu/hriv/commit/7697062cba81b2f8ef39ab0fe24388f4f9b0a0b4))
* Phase 5 — Refinements (optimistic concurrency, task queue, rate limiting) ([178de9c](https://github.com/bcit-tlu/hriv/commit/178de9cb51a476ebdc0942178a755783d2cc0e42))
* Rancher-style OIDC login toggle and fix session persistence ([d68a3ae](https://github.com/bcit-tlu/hriv/commit/d68a3ae047b25370a9b0377ca5aa6eac451fea57))
* refresh categories on Home tab navigation and add inactive icon to viewer ([863c4c8](https://github.com/bcit-tlu/hriv/commit/863c4c86b2fa7050eddc995765e7e69ca794a1ae))
* toolbar UI improvements per user feedback ([3cb45d0](https://github.com/bcit-tlu/hriv/commit/3cb45d0e42af5cba1fadee48421ce8be066f102a))
* update snackbar view link - rename to 'View image', add blue color and 10px left padding ([6569654](https://github.com/bcit-tlu/hriv/commit/65696543266874f94f0eb138e7c94ca0dd29bdc5))


### Bug Fixes

* add 'cancelled' to terminal state check in pollTask ([f4abe02](https://github.com/bcit-tlu/hriv/commit/f4abe021cbe012c6f811138f42e3491627959731))
* add matching zIndex to share-link snackbar for consistent layering ([2b66993](https://github.com/bcit-tlu/hriv/commit/2b669939ba65abfb21877b8fdfc64a2ee7aeb98f))
* add missing onEditCategory and onToggleVisibility to browse-view EditImageModal ([77ee7d1](https://github.com/bcit-tlu/hriv/commit/77ee7d147955e553384891cdf9dc1d81080d2a53))
* add tooltip on disabled clear button explaining locked overlays ([#143](https://github.com/bcit-tlu/hriv/issues/143)) ([e957ef5](https://github.com/bcit-tlu/hriv/commit/e957ef516ec3a72c5f98555aa0bce3800388f668))
* address review findings — revert arq in bulk import, fix stale version on clear overlays ([3fc53c0](https://github.com/bcit-tlu/hriv/commit/3fc53c08648ca17c49a37190b273ea6c8359bc36))
* **admin:** round formatBytes before unit selection to avoid '1024 KB' ([33f729d](https://github.com/bcit-tlu/hriv/commit/33f729d238501536c40f48dba46e73a08e3d501e))
* await data refresh before showing completion snackbar ([8eee04f](https://github.com/bcit-tlu/hriv/commit/8eee04fe5c2a40137d1e491fb878722b26244da1))
* call deleteImage API directly so dialog stays open on failure ([75931b9](https://github.com/bcit-tlu/hriv/commit/75931b9693bf50de38159faf4348718e9203d7f7))
* capture URL hash at module load to prevent child effect from stripping it ([f9eed7b](https://github.com/bcit-tlu/hriv/commit/f9eed7b1caa8cdc766876d5501c65f0745d4caca))
* clear debounce on image change, local annotation state, sanitize link URLs ([847aec5](https://github.com/bcit-tlu/hriv/commit/847aec5a2fb8bd490e663f17bcf4e91e7faad467))
* clear processing jobs on logout to prevent orphaned polling ([68dbc10](https://github.com/bcit-tlu/hriv/commit/68dbc10c6f2496284a1ec824422c0f75b28cb45a))
* close New Category dialog on Enter/Return key press ([48a9d77](https://github.com/bcit-tlu/hriv/commit/48a9d77c4b0010ccde866ee056ad33e7a5ca72ad))
* correct OSD button icon suffix order (group before hover) ([4c35032](https://github.com/bcit-tlu/hriv/commit/4c35032dad4cd9c45ce5f34fb3b4a85bf98575cd))
* correct vpFontSize formula so text/hyperlink annotations persist and render correctly ([7347396](https://github.com/bcit-tlu/hriv/commit/7347396c1d1bb80793023ae141d07370b44390da))
* debounce annotation saves, fix null sentinel, reset edit button outline ([c37f53a](https://github.com/bcit-tlu/hriv/commit/c37f53a8b7c7f82e70923508f58d0db3f9e77769))
* destructure onViewImage in EditImageModal wrapper component ([9533364](https://github.com/bcit-tlu/hriv/commit/9533364dee4b14b1187690611afc9e1a8b9600fa))
* disable Edit Details button while canvas edit mode is active ([fc0ab56](https://github.com/bcit-tlu/hriv/commit/fc0ab5645f491ff1b92708440734898b12d2834d))
* Done button immediate save and race condition between canvas save and lock/clear ([9cec760](https://github.com/bcit-tlu/hriv/commit/9cec76087ce8ad331d08cdc630830fa4342efc83))
* eliminate inline-block descender gap on active-state toolbar buttons ([aa65e60](https://github.com/bcit-tlu/hriv/commit/aa65e603a71b556fe3a1eb201d329e31dea6f827))
* fetch fresh data on View click to avoid stale-closure race ([a433146](https://github.com/bcit-tlu/hriv/commit/a4331460e606c173488b98b0d6885cf06b9012b7))
* **frontend:** move upload config to top-level regex location ([8acc84c](https://github.com/bcit-tlu/hriv/commit/8acc84c7966cf19bc7dd6e49e17ecad5b92908c1))
* **frontend:** scope client_max_body_size to upload endpoints (P8/[#21](https://github.com/bcit-tlu/hriv/issues/21)) ([b229072](https://github.com/bcit-tlu/hriv/commit/b229072c393601f96b558d1c819306dc1f1ad989))
* gate clear API call on canEditContent, fix unlock tooltip text ([7fbaf95](https://github.com/bcit-tlu/hriv/commit/7fbaf95ab77eae9274c32824a866433eeb429817))
* guard in-flight save with image ID to prevent cross-image corruption ([02babfc](https://github.com/bcit-tlu/hriv/commit/02babfc77ee39dde7e5f9d9282ee3db81dc00345))
* guard localStorage in OS-preference handler + add unit tests ([5f717df](https://github.com/bcit-tlu/hriv/commit/5f717dfed2fa8b204a62907b8d1c10b1791a3629))
* ignore clickaway dismissal on processing Snackbars ([a4c6660](https://github.com/bcit-tlu/hriv/commit/a4c666016219b5d06a72a3a182483d1a4f3c985d))
* make db import atomic and use token-based download auth ([b65cc80](https://github.com/bcit-tlu/hriv/commit/b65cc805c2ba924b307d01ab1b93262db8041a30))
* match Bulk Import category picker to Add Image (includeRoot, default label) ([3370c9e](https://github.com/bcit-tlu/hriv/commit/3370c9e7aa4159679da07a7ce519216889d390db))
* migrate legacy corgi_token/corgi_user localStorage keys to hriv ([4c84836](https://github.com/bcit-tlu/hriv/commit/4c84836572f06fb97520a7974fd29637ee792a0a))
* move Snackbars to bottom-right with z-index above modals ([17292fb](https://github.com/bcit-tlu/hriv/commit/17292fbab6acef34146865e27329e3e8e15f3c60))
* **oidc:** redirect to frontend with error codes instead of raw JSON (P20) ([1b56b17](https://github.com/bcit-tlu/hriv/commit/1b56b1742ff793770380a20afec37aa2c5750d99))
* only count actively-processing jobs toward MAX_PROCESSING_JOBS limit ([c11a2af](https://github.com/bcit-tlu/hriv/commit/c11a2afabf93e44e0faa5adf1710c4a652455be5))
* persist rotation and ellipse side-handle resize in canvas annotations ([ff428ab](https://github.com/bcit-tlu/hriv/commit/ff428abf4dd4052b83ef8c582171b9635258fb03))
* position share-link snackbar to bottom-right for consistency ([09f238a](https://github.com/bcit-tlu/hriv/commit/09f238a342287128993c526ae77aa8ee1e74a58b))
* prevent degenerate line when Shift-square drag is axis-aligned ([37546c9](https://github.com/bcit-tlu/hriv/commit/37546c9f9aabf3f8c0dfdc466b9620b1e960858c))
* prevent dialog dismiss via backdrop/Escape during active deletion ([c7f761e](https://github.com/bcit-tlu/hriv/commit/c7f761e9107873d11b4bada5bda07a2a3ba4f5d1))
* prevent duplicate API calls on Home tab click ([ad4a5ac](https://github.com/bcit-tlu/hriv/commit/ad4a5ac3959e3dffae42959bcc1d50cb3e06542f))
* prevent polling tight loop by storing progress in ref instead of state ([7696e5d](https://github.com/bcit-tlu/hriv/commit/7696e5d65e8e14ba06f01c25294d83d84dd4f161))
* prevent stale metadata overwrites and IText deletion on Backspace ([6b2391d](https://github.com/bcit-tlu/hriv/commit/6b2391d52d7b6c94161dc7c0c04127c054d67ceb))
* refresh category tree after lock/clear, avoid viewer remount ([87f5dda](https://github.com/bcit-tlu/hriv/commit/87f5dda142679cefd493d70f7a154c349316dc01))
* refresh uncategorized images after lock/clear overlay metadata ([2fea61d](https://github.com/bcit-tlu/hriv/commit/2fea61d4ef6b1b79c37472af45e1eecb9edde248))
* **release:** correct extra-files paths in release-please config ([#163](https://github.com/bcit-tlu/hriv/issues/163)) ([3a788ac](https://github.com/bcit-tlu/hriv/commit/3a788ac287f40a45c0146fcc21555ea65179105b))
* **release:** use rc1 prerelease format instead of rc.1 ([#166](https://github.com/bcit-tlu/hriv/issues/166)) ([277045b](https://github.com/bcit-tlu/hriv/commit/277045b79fdbc652ba1b9864de5fa0f591af324f))
* remove redundant done-job removal useEffect, rely on Snackbar autoHideDuration ([f7810fd](https://github.com/bcit-tlu/hriv/commit/f7810fd19faaf405265715e542769baa7d9982bb))
* remove redundant type comparison flagged by TypeScript strict mode ([1aace47](https://github.com/bcit-tlu/hriv/commit/1aace476e7b0ddc4d27f0a89a95b08ecba48be52))
* remove stale hasLockedOverlays guard, update all OSD lock icon states ([ad50ad3](https://github.com/bcit-tlu/hriv/commit/ad50ad3fdae875266801501a342fc7a6af3e8088))
* remove unused handleDeleteImage function to fix TS6133 ([f4e4d6b](https://github.com/bcit-tlu/hriv/commit/f4e4d6b6a62514904bb419a1adb43c410e6e615a))
* reorder setProcessingJobs before await to prevent duplicate polls ([a740965](https://github.com/bcit-tlu/hriv/commit/a7409654a87c6382333374d644d55e19139d5973))
* reset rotation when home icon is clicked ([#141](https://github.com/bcit-tlu/hriv/issues/141)) ([8d05e06](https://github.com/bcit-tlu/hriv/commit/8d05e0637a3660db80c0671fbbee2d71e62e9bae))
* resolve stale metadata, overlay validation, and viewer re-creation ([#40](https://github.com/bcit-tlu/hriv/issues/40), [#41](https://github.com/bcit-tlu/hriv/issues/41), [#42](https://github.com/bcit-tlu/hriv/issues/42)) ([#123](https://github.com/bcit-tlu/hriv/issues/123)) ([32838ea](https://github.com/bcit-tlu/hriv/commit/32838eaa6f1ca9ac76989ca399658836141bd759))
* resolve stale UI and delayed visit-link after mutations ([5bb206f](https://github.com/bcit-tlu/hriv/commit/5bb206f06339c47eb4f753721b98dee33caa3ecc))
* retain overlay text/link colour on save & exit edit mode ([#130](https://github.com/bcit-tlu/hriv/issues/130)) ([ae2932f](https://github.com/bcit-tlu/hriv/commit/ae2932fa8d913b145295686daafd7a683fb10a75))
* show cancelled tasks with warning severity and correct text in snackbar ([1f46ad5](https://github.com/bcit-tlu/hriv/commit/1f46ad5b00a10513e4b6f02736534ad8eb4a62d2))
* stack share-link snackbar above processing snackbars to prevent overlap ([b20585b](https://github.com/bcit-tlu/hriv/commit/b20585b0cddc63bb9bd903538e29b4ad30794efd))
* sync program dropdowns across all modals by lifting state to App ([ed767f9](https://github.com/bcit-tlu/hriv/commit/ed767f9e746599c9ce85da3d648ffe7f744c8b4f))
* unlock only re-enables clear button, does not remove metadata ([8cbde72](https://github.com/bcit-tlu/hriv/commit/8cbde72b52caaa7a19171b0e5fc5163992ffce3d))
* use backend instance epoch instead of sessionStorage for session invalidation ([d4c921f](https://github.com/bcit-tlu/hriv/commit/d4c921f440d67306bac1fb2534635d8aef2688bb))
* use center pivot for text/link view-mode rotation ([53d912a](https://github.com/bcit-tlu/hriv/commit/53d912a95aa1ebef8cfc00cacb4081c1d1d6704c))
* use CSS padding for category dropdown indentation instead of text spaces ([967da7d](https://github.com/bcit-tlu/hriv/commit/967da7d6808afa0469f046e9d8ca280b3d256a28))
* use origin-based rotation pivot for all view-mode annotation types ([46bb84a](https://github.com/bcit-tlu/hriv/commit/46bb84ad0813d8a1eec2e3165070c0e44090b69a))
* use outline with negative offset to render border on top of button images ([4f773d9](https://github.com/bcit-tlu/hriv/commit/4f773d998027816e0c6eec512a3e972826489c94))
* use overlay box red for active-state toolbar border color ([a5614fc](https://github.com/bcit-tlu/hriv/commit/a5614fc96ffd1b193791d00ce8b4e8ab9dd690da))
* use palette color and inset box-shadow for active toolbar buttons ([3ba99cc](https://github.com/bcit-tlu/hriv/commit/3ba99cc79fcc5715f7c8060e82a964dd24bc1607))
* use ref instead of stale state in flushCanvasAnnotations ([e9188d1](https://github.com/bcit-tlu/hriv/commit/e9188d1a3267c6503646a776f07a02ff18001a89))


### Performance Improvements

* optimize frontend Dockerfile with Alpine base (507MB → 417MB) ([75e0622](https://github.com/bcit-tlu/hriv/commit/75e0622ab5f8c97e0c5b72a170627b6db240ae50))

## [0.7.0-rc](https://github.com/bcit-tlu/hriv/compare/frontend-v0.6.0...frontend-v0.7.0-rc) (2026-04-21)


### Features

* **frontend:** add 'follow OS' option to theme toggle ([#153](https://github.com/bcit-tlu/hriv/issues/153)) ([e928df6](https://github.com/bcit-tlu/hriv/commit/e928df6b051da0914f2528133213a881bbf0deba))


### Bug Fixes

* **release:** correct extra-files paths in release-please config ([#163](https://github.com/bcit-tlu/hriv/issues/163)) ([3a788ac](https://github.com/bcit-tlu/hriv/commit/3a788ac287f40a45c0146fcc21555ea65179105b))

## [0.6.0](https://github.com/bcit-tlu/hriv/compare/frontend-v0.6.0-rc...frontend-v0.6.0) (2026-04-21)


### Features

* gate footer versions to admins and surface per-component versions ([#149](https://github.com/bcit-tlu/hriv/issues/149)) ([#150](https://github.com/bcit-tlu/hriv/issues/150)) ([b3447dd](https://github.com/bcit-tlu/hriv/commit/b3447dd997a419485b17804b8823d0b0d3c06fda))


### Bug Fixes

* add tooltip on disabled clear button explaining locked overlays ([#143](https://github.com/bcit-tlu/hriv/issues/143)) ([e957ef5](https://github.com/bcit-tlu/hriv/commit/e957ef516ec3a72c5f98555aa0bce3800388f668))

## [0.6.0-rc](https://github.com/bcit-tlu/hriv/compare/frontend-v0.5.2-rc...frontend-v0.6.0-rc) (2026-04-20)


### Features

* center-crop card thumbnails for recognisable image previews ([#140](https://github.com/bcit-tlu/hriv/issues/140)) ([ec9f31c](https://github.com/bcit-tlu/hriv/commit/ec9f31c3db00de849c66765b74c081794d6225df))


### Bug Fixes

* reset rotation when home icon is clicked ([#141](https://github.com/bcit-tlu/hriv/issues/141)) ([8d05e06](https://github.com/bcit-tlu/hriv/commit/8d05e0637a3660db80c0671fbbee2d71e62e9bae))
* retain overlay text/link colour on save & exit edit mode ([#130](https://github.com/bcit-tlu/hriv/issues/130)) ([ae2932f](https://github.com/bcit-tlu/hriv/commit/ae2932fa8d913b145295686daafd7a683fb10a75))

## [0.5.2-rc](https://github.com/bcit-tlu/hriv/compare/frontend-v0.5.1...frontend-v0.5.2-rc) (2026-04-20)


### Bug Fixes

* resolve stale metadata, overlay validation, and viewer re-creation ([#40](https://github.com/bcit-tlu/hriv/issues/40), [#41](https://github.com/bcit-tlu/hriv/issues/41), [#42](https://github.com/bcit-tlu/hriv/issues/42)) ([#123](https://github.com/bcit-tlu/hriv/issues/123)) ([32838ea](https://github.com/bcit-tlu/hriv/commit/32838eaa6f1ca9ac76989ca399658836141bd759))

## [0.5.1](https://github.com/bcit-tlu/hriv/compare/frontend-v0.5.0...frontend-v0.5.1) (2026-04-19)


### Bug Fixes

* **frontend:** move upload config to top-level regex location ([8acc84c](https://github.com/bcit-tlu/hriv/commit/8acc84c7966cf19bc7dd6e49e17ecad5b92908c1))
* **frontend:** scope client_max_body_size to upload endpoints (P8/[#21](https://github.com/bcit-tlu/hriv/issues/21)) ([b229072](https://github.com/bcit-tlu/hriv/commit/b229072c393601f96b558d1c819306dc1f1ad989))

## [0.5.0](https://github.com/bcit-tlu/hriv/compare/frontend-v0.4.0...frontend-v0.5.0) (2026-04-18)


### Features

* **admin:** confirm destructive import before firing API call (P18) ([212bc7f](https://github.com/bcit-tlu/hriv/commit/212bc7f3cec68addc9d42499df550db18f1fc8ed))


### Bug Fixes

* **admin:** round formatBytes before unit selection to avoid '1024 KB' ([33f729d](https://github.com/bcit-tlu/hriv/commit/33f729d238501536c40f48dba46e73a08e3d501e))
* **oidc:** redirect to frontend with error codes instead of raw JSON (P20) ([1b56b17](https://github.com/bcit-tlu/hriv/commit/1b56b1742ff793770380a20afec37aa2c5750d99))

## [0.4.0](https://github.com/bcit-tlu/hriv/compare/frontend-v0.3.0...frontend-v0.4.0) (2026-04-18)


### Features

* **admin:** auto-scroll log viewer, byte-based export progress, force-cancel fix ([3a4d240](https://github.com/bcit-tlu/hriv/commit/3a4d24095b96f1ad0c6dfef963d24a83c5e702c2))
* **admin:** expose force-cancel in the UI for tasks stuck in 'cancelling' ([abf8cfe](https://github.com/bcit-tlu/hriv/commit/abf8cfe59f5c5a9f087e6682ecd57b67d7b355f3))

## [0.3.0](https://github.com/bcit-tlu/hriv/compare/frontend-v0.2.0...frontend-v0.3.0) (2026-04-18)


### Features

* add task cancellation with cancel button in UI ([1a60d7d](https://github.com/bcit-tlu/hriv/commit/1a60d7dfc79b90de07f7b69510f8e4128d15f339))
* decouple admin import/export into background tasks with snackbar notifications ([374a197](https://github.com/bcit-tlu/hriv/commit/374a197318125f062b5ee214b964935cffc8b80a))


### Bug Fixes

* add 'cancelled' to terminal state check in pollTask ([f4abe02](https://github.com/bcit-tlu/hriv/commit/f4abe021cbe012c6f811138f42e3491627959731))
* make db import atomic and use token-based download auth ([b65cc80](https://github.com/bcit-tlu/hriv/commit/b65cc805c2ba924b307d01ab1b93262db8041a30))
* show cancelled tasks with warning severity and correct text in snackbar ([1f46ad5](https://github.com/bcit-tlu/hriv/commit/1f46ad5b00a10513e4b6f02736534ad8eb4a62d2))

## [0.2.0](https://github.com/bcit-tlu/hriv/compare/frontend-v0.1.0...frontend-v0.2.0) (2026-04-15)


### Features

* add 50-result cap, filter chips for type/field, and union-based multi-term search ([7930dab](https://github.com/bcit-tlu/hriv/commit/7930dabcadbee3a8f441bf285a3ad9f0b765a529))
* add async handlers + loading state to bulk edit modal ([51760a9](https://github.com/bcit-tlu/hriv/commit/51760a937165a7b44bb429535c1a4f96647a3f96))
* add bulk edit capability to Images page ([baeccee](https://github.com/bcit-tlu/hriv/commit/baeccee2723beca6de143e25572c4578cd7ec980))
* add bulk image import capability for admin role ([834f550](https://github.com/bcit-tlu/hriv/commit/834f55000987c3e4667c17af38e40e15ab8c89c3))
* add category visibility toggle to hide categories from students ([dbfd50e](https://github.com/bcit-tlu/hriv/commit/dbfd50e63fda1c3acd77858d1669030855d7deed))
* add clear button to remove all selection rectangles ([dde8dc1](https://github.com/bcit-tlu/hriv/commit/dde8dc1f725c171c2c8ab275f2091ba565de0d4d))
* add column filters to Images table and update program helper text ([65a812c](https://github.com/bcit-tlu/hriv/commit/65a812c4b095c3b6cecb4019bced07d45c2ab1c4))
* add confirmation dialog before category deletion ([83278c9](https://github.com/bcit-tlu/hriv/commit/83278c9ad99e39b03941681edc589caffadf84bf))
* add confirmation dialog for View Image when form has unsaved changes ([f19093b](https://github.com/bcit-tlu/hriv/commit/f19093b5af0e17ec0c6913dbd8ff15dcbc818ba7))
* add dark mode toggle with customizable color palettes ([b5a71e1](https://github.com/bcit-tlu/hriv/commit/b5a71e1b282c1005ac1259ecdf8de5c5cbd0c4b2))
* add delete confirmation dialog to Images tab row action ([fbb5a1a](https://github.com/bcit-tlu/hriv/commit/fbb5a1a868ace51cf363c140c76273c24ccfae60))
* add drag-and-drop reordering to Manage Categories dialog ([444ec21](https://github.com/bcit-tlu/hriv/commit/444ec21c30df24370d44eada69b60518d64a6b83))
* add dynamic measurement indicators to selection rectangle overlay ([7cd1198](https://github.com/bcit-tlu/hriv/commit/7cd11989764892775aefcce7fac572b64d78e44c))
* add edit/rename category functionality to all category lists ([4b9024c](https://github.com/bcit-tlu/hriv/commit/4b9024c6bcee0e0fb48a43146c61793f79c8113f))
* add error feedback to announcement save dialog ([c213840](https://github.com/bcit-tlu/hriv/commit/c2138407bc02346f28344708d36f907062d7fa18))
* add filesystem snapshot export/import and source_images to DB backup ([e764a6a](https://github.com/bcit-tlu/hriv/commit/e764a6a99a9999e67b80c14d58dfca554dd1e2c3))
* add image metadata below viewer, fix breadcrumbs when viewing from Images table ([8151c08](https://github.com/bcit-tlu/hriv/commit/8151c084950d05c30b2c7d5cc9a904caf9cb74b1))
* add image processing progress indicator and auto-refresh ([5fd9592](https://github.com/bcit-tlu/hriv/commit/5fd9592c140c4a327aa7282bf4e5e35f206f5c0e))
* add image processing progress indicator and auto-refresh ([3514f63](https://github.com/bcit-tlu/hriv/commit/3514f637964e820543128e8094c338b3be18926c))
* add inline category creation from category picker dropdown ([6e2b251](https://github.com/bcit-tlu/hriv/commit/6e2b251df2050432601bbe821801e44117905898))
* add inline category creation to Bulk Edit Images modal ([486a439](https://github.com/bcit-tlu/hriv/commit/486a439836b75182b85343eae1c128f984d36aea))
* add inline category creation to Move Category dialog ([f836450](https://github.com/bcit-tlu/hriv/commit/f83645013cd45689963a1cc14a15ed8097c07581))
* add lightweight canvas overlay for image annotations ([8bf18ab](https://github.com/bcit-tlu/hriv/commit/8bf18abbe081a120e59d30433c1e89bbaf55d7f2))
* add lock/unlock overlay persistence with role-based access ([c047be7](https://github.com/bcit-tlu/hriv/commit/c047be77ce1fb40e53a02810aab5e05778f71408))
* add modal-based text search across categories, images, programs, and users ([4505426](https://github.com/bcit-tlu/hriv/commit/4505426f0e682640e68f3108ad7e3a877688d4f2))
* add outline folder icon to category card title ([db1b5c0](https://github.com/bcit-tlu/hriv/commit/db1b5c06a0637a6a961b5aed69ab05f94183450f))
* add pagination, collapsible filters, and upload refresh to Images table ([6f951cf](https://github.com/bcit-tlu/hriv/commit/6f951cf7a1094d166588c90a00a98c0fffdc8595))
* add processing progress percentage to snackbar ([5c7197b](https://github.com/bcit-tlu/hriv/commit/5c7197b3b0c5f04058f39f23a134a4bda2b83d09))
* add Report Issue modal and version footer ([82fa81f](https://github.com/bcit-tlu/hriv/commit/82fa81fdfe7b61572b55c777715cb3dd68b43f4f))
* add rotation controls to OpenSeadragon image viewer ([c804b90](https://github.com/bcit-tlu/hriv/commit/c804b90df72e88822a9e5a09dcbd049264438bce))
* add selection rectangle tool to OpenSeaDragon toolbar ([e64565d](https://github.com/bcit-tlu/hriv/commit/e64565d0e54497147b727597f7d89dcc79f24015))
* add shareable URL support for image viewer ([e34bc7c](https://github.com/bcit-tlu/hriv/commit/e34bc7c05913d32404c746b12491c153f4a7e332))
* add TIFF file support with large file upload handling ([04b57a1](https://github.com/bcit-tlu/hriv/commit/04b57a1a42e2bdf37f13f67194234c4b20b95a64))
* add View link in snackbar after successful image upload/process ([f608b61](https://github.com/bcit-tlu/hriv/commit/f608b61a6f6086ca2a5470ada267ee3c681f978a))
* add visual indicator for inactive images on card tiles ([cadce50](https://github.com/bcit-tlu/hriv/commit/cadce5053dd10519cc366777c6fb5f45d019ecc4))
* align People page buttons with Images page layout, full-page light grey background ([7d8b899](https://github.com/bcit-tlu/hriv/commit/7d8b899f002d39662647c4da2b61446ae6302937))
* apply Colormind color palette per issue [#22](https://github.com/bcit-tlu/hriv/issues/22) ([945fb1b](https://github.com/bcit-tlu/hriv/commit/945fb1be1d56fb204a12b140b9a48d5638224331))
* arrow styles, line thickness, fill/outline, text save fix, debug logging ([8384c56](https://github.com/bcit-tlu/hriv/commit/8384c56691a190b8400bc05cee6a3127496e71f6))
* card heading h6, category card details, card image picker ([7813c8d](https://github.com/bcit-tlu/hriv/commit/7813c8dea751279b6dd026b74ea06816fd3633ad))
* **ci:** automated CI/CD pipeline with Release Please, OCI Helm charts, and Flux GitOps ([eb0657e](https://github.com/bcit-tlu/hriv/commit/eb0657ea802ff9ac94c4ec028da8a201088d56ab))
* **ci:** switch to per-component Release Please packages for independent versioning ([de8ff81](https://github.com/bcit-tlu/hriv/commit/de8ff8108da1d4a8af08cc4017de251435d700ba))
* consistent category dropdowns, upload modal fields, and clickable drop canvas ([0155137](https://github.com/bcit-tlu/hriv/commit/0155137c52818ddaa5ad9cba0d409c0d68bd9012))
* consolidate Replace and Details into single Edit Details modal ([f644d12](https://github.com/bcit-tlu/hriv/commit/f644d12683060b4b2ae7bd0d46238210a7cd0914))
* convert image active status from string to boolean with role-based visibility ([2e9f5fa](https://github.com/bcit-tlu/hriv/commit/2e9f5faabe0e2e043375d8fdef2397ec46512cd9))
* display image dimensions and file size on image cards ([8f1b244](https://github.com/bcit-tlu/hriv/commit/8f1b2447e5981d1bcb14929e503ffed2b4790365))
* enhance Images table with column renames, status switch, sort, modified column, move action, and bulk edit button ([90b6426](https://github.com/bcit-tlu/hriv/commit/90b64260a5b5867a16c25917b182be7c92245c3d))
* ensure cursor focus in new category name field via ref + onEntered ([891490d](https://github.com/bcit-tlu/hriv/commit/891490d0d3ab96e1281a8256d8cf4792b0902ba0))
* frontend corrections - tab order, button variants, footer, permissions ([f990f02](https://github.com/bcit-tlu/hriv/commit/f990f027a80fd0884feb3cb48460725f1675e2a3))
* frontend design tweaks – breadcrumbs, metadata, toolbars, page styling ([39d7cce](https://github.com/bcit-tlu/hriv/commit/39d7cce036b16a78bec201f3640b4a8a33e07126))
* frontend tweaks - container padding, ellipsis edit icon, disabled drop canvas, bold timestamps ([019959b](https://github.com/bcit-tlu/hriv/commit/019959bf1ffd93301b19e6ed722d011345d47e93))
* frontend tweaks - remove logo anchor, edit details on viewer, OSD controls position, fix label visibility, add program count to category cards ([32e4b48](https://github.com/bcit-tlu/hriv/commit/32e4b484a76b02641005b62fd97c5ea7f3c54b08))
* frontend tweaks - View Image button, category auto-select, table cleanup, footer link ([9f4c6a5](https://github.com/bcit-tlu/hriv/commit/9f4c6a50d113a8009015f1b9aaa6d2d90d2001cb))
* **frontend:** add forgot password modal to login form ([8ab7bc0](https://github.com/bcit-tlu/hriv/commit/8ab7bc0bdb19ca53255a496eea5b25b022c622f6))
* **frontend:** add login field labels for username and password ([242a69c](https://github.com/bcit-tlu/hriv/commit/242a69cae580bf7f7a17dcdd3ae8ad00995f9c89))
* **frontend:** update login splash image with attribution overlay ([46ae915](https://github.com/bcit-tlu/hriv/commit/46ae9156ecd7acfc9e97ca76cbb113d131f591e2))
* **frontend:** update login splash with attribution and add field labels ([e28c242](https://github.com/bcit-tlu/hriv/commit/e28c242459e0ffa14763c64870b0081045466cc3))
* **frontend:** use hriv splash image and remove login attribution overlay ([850a4da](https://github.com/bcit-tlu/hriv/commit/850a4da9f72583574b966bb3b479208a379a1791))
* granular progress tracking via pyvips eval signals and status messages ([571b268](https://github.com/bcit-tlu/hriv/commit/571b268fddf9340b138b310fc8bdbf7d72ac57be))
* hold Shift while drawing to constrain rectangle to a square ([02da722](https://github.com/bcit-tlu/hriv/commit/02da7221435a5fe694fdf994dc04c936db472b7d))
* implement final frontend UI/UX tweaks ([d84de51](https://github.com/bcit-tlu/hriv/commit/d84de51a8df2b700d4115628fb1e4745ddbb7087))
* increase share view overlay limit from 5 to 10 ([b23dd52](https://github.com/bcit-tlu/hriv/commit/b23dd525a7fb04a13389703c01aa2c31d22db839))
* maximize MUI Container to use full viewport width for widescreen displays ([491ccaf](https://github.com/bcit-tlu/hriv/commit/491ccaf7905ecadae05e1dfc37b6cc841461a407))
* mirror Add Image fields in Bulk Import modal via shared ImageMetadataFields component ([6a73c6b](https://github.com/bcit-tlu/hriv/commit/6a73c6bd65cfa7467bbb789ae234f53a3ac53fa8))
* persist search query and filters across modal open/close cycles ([7697062](https://github.com/bcit-tlu/hriv/commit/7697062cba81b2f8ef39ab0fe24388f4f9b0a0b4))
* Phase 5 — Refinements (optimistic concurrency, task queue, rate limiting) ([178de9c](https://github.com/bcit-tlu/hriv/commit/178de9cb51a476ebdc0942178a755783d2cc0e42))
* Rancher-style OIDC login toggle and fix session persistence ([d68a3ae](https://github.com/bcit-tlu/hriv/commit/d68a3ae047b25370a9b0377ca5aa6eac451fea57))
* refresh categories on Home tab navigation and add inactive icon to viewer ([863c4c8](https://github.com/bcit-tlu/hriv/commit/863c4c86b2fa7050eddc995765e7e69ca794a1ae))
* replace New Category button with Add/Edit Categories dialog ([aa900f9](https://github.com/bcit-tlu/hriv/commit/aa900f9232372a3f5e8409323bc38588a9f33744))
* replace program counts with program name chips on category and image cards ([adb1880](https://github.com/bcit-tlu/hriv/commit/adb188065fbbdc061e4eafb7ac5faa681520d4df))
* right-align action buttons inline with breadcrumbs, add buttons to Images page, grey Manage button ([a0489f3](https://github.com/bcit-tlu/hriv/commit/a0489f3d9831ad4229cfe443c261520ec0049be6))
* serialize overlay rectangles in share view URL (up to 5) ([29c97ca](https://github.com/bcit-tlu/hriv/commit/29c97cadf5a54efbcdc55db1c98e8a54a5667bf7))
* standardize program selection across Upload Image and Bulk Edit modals ([2d68233](https://github.com/bcit-tlu/hriv/commit/2d682335a5ad3443af81b41d3645308e5d1058f0))
* toolbar UI improvements per user feedback ([3cb45d0](https://github.com/bcit-tlu/hriv/commit/3cb45d0e42af5cba1fadee48421ce8be066f102a))
* update delete icons and logout link to primary color, cache-bust login splash ([c61e963](https://github.com/bcit-tlu/hriv/commit/c61e963cd91b17d13d998ec7765ea982b7f27506))
* update favicon to SVG, add logo to app bar with home link, set primary.dark to [#7](https://github.com/bcit-tlu/hriv/issues/7)A3535 ([2d748e3](https://github.com/bcit-tlu/hriv/commit/2d748e308135cb5dc6c1c609c6ca9f06d41b44f4))
* update snackbar view link - rename to 'View image', add blue color and 10px left padding ([6569654](https://github.com/bcit-tlu/hriv/commit/65696543266874f94f0eb138e7c94ca0dd29bdc5))


### Bug Fixes

* add active field to ApiSourceImage TypeScript interface ([146d07a](https://github.com/bcit-tlu/hriv/commit/146d07a5df7c59e8bbe69ce7a44612faca4ac67a))
* add matching zIndex to share-link snackbar for consistent layering ([2b66993](https://github.com/bcit-tlu/hriv/commit/2b669939ba65abfb21877b8fdfc64a2ee7aeb98f))
* add missing onEditCategory and onToggleVisibility to browse-view EditImageModal ([77ee7d1](https://github.com/bcit-tlu/hriv/commit/77ee7d147955e553384891cdf9dc1d81080d2a53))
* add NaN guards for URL param parsing ([6b16465](https://github.com/bcit-tlu/hriv/commit/6b1646516d2ecc0d8d74b7c9bf91f926dde55790))
* add saving state to MoveImageDialog to prevent duplicate submissions ([8eda740](https://github.com/bcit-tlu/hriv/commit/8eda7406fea4596b383d9d9e6a944d2b740fce44))
* address issues [#18](https://github.com/bcit-tlu/hriv/issues/18)-22 - UI tweaks, login updates, favicon, colour palette ([9aa98dd](https://github.com/bcit-tlu/hriv/commit/9aa98dd1c7828fd4c1cf09060a7092af4b9cc6e6))
* address review findings — revert arq in bulk import, fix stale version on clear overlays ([3fc53c0](https://github.com/bcit-tlu/hriv/commit/3fc53c08648ca17c49a37190b273ea6c8359bc36))
* auto-correct currentPage when dataset shrinks after delete/bulk-delete ([7ebf1d6](https://github.com/bcit-tlu/hriv/commit/7ebf1d60d73bd4aca85b9178531f5bbff8b3b3b2))
* await data refresh before showing completion snackbar ([8eee04f](https://github.com/bcit-tlu/hriv/commit/8eee04fe5c2a40137d1e491fb878722b26244da1))
* call deleteImage API directly so dialog stays open on failure ([75931b9](https://github.com/bcit-tlu/hriv/commit/75931b9693bf50de38159faf4348718e9203d7f7))
* capture URL hash at module load to prevent child effect from stripping it ([f9eed7b](https://github.com/bcit-tlu/hriv/commit/f9eed7b1caa8cdc766876d5501c65f0745d4caca))
* checkbox state uses selectedInView for correct filter-aware display ([171bfe9](https://github.com/bcit-tlu/hriv/commit/171bfe90dc07fa747a261b7a000501407ed9b840))
* clear debounce on image change, local annotation state, sanitize link URLs ([847aec5](https://github.com/bcit-tlu/hriv/commit/847aec5a2fb8bd490e663f17bcf4e91e7faad467))
* clear overlay state on user change and search navigation ([02a0f48](https://github.com/bcit-tlu/hriv/commit/02a0f480adc8b6b943208a7d28555f88eecc13cf))
* clear pendingImageId when image doesn't exist to unblock URL sync ([d5420a6](https://github.com/bcit-tlu/hriv/commit/d5420a643f9170fd89c61d7b19ee3be1d3a70b95))
* clear processing jobs on logout to prevent orphaned polling ([68dbc10](https://github.com/bcit-tlu/hriv/commit/68dbc10c6f2496284a1ec824422c0f75b28cb45a))
* clear setTimeout on modal close to prevent race condition ([2c23671](https://github.com/bcit-tlu/hriv/commit/2c23671bf5251e5fb394f3bbd3e699d53cb543ca))
* clear stale path when deleting a category in current browse path ([cc88244](https://github.com/bcit-tlu/hriv/commit/cc882446573d189420008a2d35bc137a53ecfe9d))
* clear viewportState on logout and defer pendingImageId consumption ([a1d10a0](https://github.com/bcit-tlu/hriv/commit/a1d10a05f6f223a2c529f114d661a5af6521634a))
* close New Category dialog on Enter/Return key press ([48a9d77](https://github.com/bcit-tlu/hriv/commit/48a9d77c4b0010ccde866ee056ad33e7a5ca72ad))
* correct mini-map text to bottom-right, update breadcrumbs after category change in viewer edit ([a9658b0](https://github.com/bcit-tlu/hriv/commit/a9658b0235cb0b1fd5c59d069ba8286abb4076ed))
* correct OSD button icon suffix order (group before hover) ([4c35032](https://github.com/bcit-tlu/hriv/commit/4c35032dad4cd9c45ce5f34fb3b4a85bf98575cd))
* correct result ID generation and filter hidden categories for students in search ([ca10983](https://github.com/bcit-tlu/hriv/commit/ca109831b40708ebdbd7bdc588187b4813b533cd))
* correct vpFontSize formula so text/hyperlink annotations persist and render correctly ([7347396](https://github.com/bcit-tlu/hriv/commit/7347396c1d1bb80793023ae141d07370b44390da))
* debounce annotation saves, fix null sentinel, reset edit button outline ([c37f53a](https://github.com/bcit-tlu/hriv/commit/c37f53a8b7c7f82e70923508f58d0db3f9e77769))
* destructure onViewImage in EditImageModal wrapper component ([9533364](https://github.com/bcit-tlu/hriv/commit/9533364dee4b14b1187690611afc9e1a8b9600fa))
* disable Edit Details button while canvas edit mode is active ([fc0ab56](https://github.com/bcit-tlu/hriv/commit/fc0ab5645f491ff1b92708440734898b12d2834d))
* Done button immediate save and race condition between canvas save and lock/clear ([9cec760](https://github.com/bcit-tlu/hriv/commit/9cec76087ce8ad331d08cdc630830fa4342efc83))
* eliminate inline-block descender gap on active-state toolbar buttons ([aa65e60](https://github.com/bcit-tlu/hriv/commit/aa65e603a71b556fe3a1eb201d329e31dea6f827))
* fetch fresh data on View click to avoid stale-closure race ([a433146](https://github.com/bcit-tlu/hriv/commit/a4331460e606c173488b98b0d6885cf06b9012b7))
* fixed modal height, add chip spacing, remove placeholder ellipsis ([6d93ed9](https://github.com/bcit-tlu/hriv/commit/6d93ed94702e84461c668c7da63cd77695437ac5))
* gate clear API call on canEditContent, fix unlock tooltip text ([7fbaf95](https://github.com/bcit-tlu/hriv/commit/7fbaf95ab77eae9274c32824a866433eeb429817))
* guard against undefined navigator.clipboard in non-secure contexts ([a0c24f9](https://github.com/bcit-tlu/hriv/commit/a0c24f9082392f0db7d67bf72045d33f875e1f92))
* guard in-flight save with image ID to prevent cross-image corruption ([02babfc](https://github.com/bcit-tlu/hriv/commit/02babfc77ee39dde7e5f9d9282ee3db81dc00345))
* guard localStorage in OS-preference handler + add unit tests ([5f717df](https://github.com/bcit-tlu/hriv/commit/5f717dfed2fa8b204a62907b8d1c10b1791a3629))
* guard releaseHandler and destroy MouseTracker on cleanup ([013fde6](https://github.com/bcit-tlu/hriv/commit/013fde66e594117396f5990709828d0ba2503a18))
* guard Tabs onChange to ignore invalid page values from Manage tab ([4c0a7f4](https://github.com/bcit-tlu/hriv/commit/4c0a7f42e620f97af2670b6de0d0a340e961df34))
* ignore clickaway dismissal on processing Snackbars ([a4c6660](https://github.com/bcit-tlu/hriv/commit/a4c666016219b5d06a72a3a182483d1a4f3c985d))
* integrate rotation into ViewportState and share links ([566ac82](https://github.com/bcit-tlu/hriv/commit/566ac8259d0c43fd1d5859bb5cf8627e35568b79))
* make container padding breakpoint-based, scaling from default at md to 120px at xl ([f8ab716](https://github.com/bcit-tlu/hriv/commit/f8ab716622a51341d7147a4469e242506a97db58))
* match Bulk Import category picker to Add Image (includeRoot, default label) ([3370c9e](https://github.com/bcit-tlu/hriv/commit/3370c9e7aa4159679da07a7ce519216889d390db))
* merge existing metadata_extra when setting card image (prevents data loss) ([841234c](https://github.com/bcit-tlu/hriv/commit/841234cb9263095ba7c6c6457fa591014a4a2ad1))
* migrate legacy corgi_token/corgi_user localStorage keys to hriv ([4c84836](https://github.com/bcit-tlu/hriv/commit/4c84836572f06fb97520a7974fd29637ee792a0a))
* move Snackbars to bottom-right with z-index above modals ([17292fb](https://github.com/bcit-tlu/hriv/commit/17292fbab6acef34146865e27329e3e8e15f3c60))
* only count actively-processing jobs toward MAX_PROCESSING_JOBS limit ([c11a2af](https://github.com/bcit-tlu/hriv/commit/c11a2afabf93e44e0faa5adf1710c4a652455be5))
* only send metadata_extra when measurement fields are set ([2441ce1](https://github.com/bcit-tlu/hriv/commit/2441ce1dcf5bfcd464f8e9b76bc1a68b395a8caf))
* persist rotation and ellipse side-handle resize in canvas annotations ([ff428ab](https://github.com/bcit-tlu/hriv/commit/ff428abf4dd4052b83ef8c582171b9635258fb03))
* position share-link snackbar to bottom-right for consistency ([09f238a](https://github.com/bcit-tlu/hriv/commit/09f238a342287128993c526ae77aa8ee1e74a58b))
* preserve shared-link URL params until pending image is resolved ([a213c60](https://github.com/bcit-tlu/hriv/commit/a213c60bd770c605fa11e31486e8317107ef83c8))
* prevent degenerate line when Shift-square drag is axis-aligned ([37546c9](https://github.com/bcit-tlu/hriv/commit/37546c9f9aabf3f8c0dfdc466b9620b1e960858c))
* prevent dialog dismiss via backdrop/Escape during active deletion ([c7f761e](https://github.com/bcit-tlu/hriv/commit/c7f761e9107873d11b4bada5bda07a2a3ba4f5d1))
* prevent duplicate API calls on Home tab click ([ad4a5ac](https://github.com/bcit-tlu/hriv/commit/ad4a5ac3959e3dffae42959bcc1d50cb3e06542f))
* prevent polling tight loop by storing progress in ref instead of state ([7696e5d](https://github.com/bcit-tlu/hriv/commit/7696e5d65e8e14ba06f01c25294d83d84dd4f161))
* prevent stale metadata overwrites and IText deletion on Backspace ([6b2391d](https://github.com/bcit-tlu/hriv/commit/6b2391d52d7b6c94161dc7c0c04127c054d67ceb))
* prune deleted image ID from selected set ([06f4b63](https://github.com/bcit-tlu/hriv/commit/06f4b6300f1b35a4dbb2608b0a1133314311217d))
* refresh categories and images after closing bulk import modal ([cd125cf](https://github.com/bcit-tlu/hriv/commit/cd125cf7afd4b5f10ff10ad6101e3138074ed2d9))
* refresh category tree after lock/clear, avoid viewer remount ([87f5dda](https://github.com/bcit-tlu/hriv/commit/87f5dda142679cefd493d70f7a154c349316dc01))
* refresh uncategorized images after lock/clear overlay metadata ([2fea61d](https://github.com/bcit-tlu/hriv/commit/2fea61d4ef6b1b79c37472af45e1eecb9edde248))
* remove redundant dialog state cleanup after async API call in handleEditSave ([7ae82ea](https://github.com/bcit-tlu/hriv/commit/7ae82ea216f3563779a0eb2f066d5195c7277724))
* remove redundant done-job removal useEffect, rely on Snackbar autoHideDuration ([f7810fd](https://github.com/bcit-tlu/hriv/commit/f7810fd19faaf405265715e542769baa7d9982bb))
* remove redundant type comparison flagged by TypeScript strict mode ([1aace47](https://github.com/bcit-tlu/hriv/commit/1aace476e7b0ddc4d27f0a89a95b08ecba48be52))
* remove stale hasLockedOverlays guard, update all OSD lock icon states ([ad50ad3](https://github.com/bcit-tlu/hriv/commit/ad50ad3fdae875266801501a342fc7a6af3e8088))
* remove unused handleDeleteImage function to fix TS6133 ([f4e4d6b](https://github.com/bcit-tlu/hriv/commit/f4e4d6b6a62514904bb419a1adb43c410e6e615a))
* remove useEffect re-sync (modal unmounts on close, useState re-initializes naturally) ([ff14b08](https://github.com/bcit-tlu/hriv/commit/ff14b08dc52d275317b2d63668dabcd243091a1a))
* rename Label→Name and Origin→Note in all modals, add timestamps to edit details ([ed7cd4a](https://github.com/bcit-tlu/hriv/commit/ed7cd4ae388b181218e36a82c77a92f5c9d8f6a2))
* reorder setProcessingJobs before await to prevent duplicate polls ([a740965](https://github.com/bcit-tlu/hriv/commit/a7409654a87c6382333374d644d55e19139d5973))
* reset browseEditImage on user change to prevent stale modal ([a2c6405](https://github.com/bcit-tlu/hriv/commit/a2c64057af0e8ddee75106aa4be520942c7e3910))
* reset imageEditOpen on user switch, guard timestamp display for empty dates ([57ca7ef](https://github.com/bcit-tlu/hriv/commit/57ca7efca3e3dbf2396d5d67bb993dc5991cb7aa))
* reset selectionModeRef and dragRef on useEffect cleanup ([0b4beb7](https://github.com/bcit-tlu/hriv/commit/0b4beb755b8991a183681b76ce4496593166877e))
* resolve frontend-to-backend connectivity timeout ([e623bb9](https://github.com/bcit-tlu/hriv/commit/e623bb9b1e0ca96227fa2d264d3e1b035139f8de))
* resolve stale UI and delayed visit-link after mutations ([5bb206f](https://github.com/bcit-tlu/hriv/commit/5bb206f06339c47eb4f753721b98dee33caa3ecc))
* scope select-all checkbox to current page only ([28f90c6](https://github.com/bcit-tlu/hriv/commit/28f90c6d6597e2a46fd76416e790cc5e856513c0))
* select-all checkbox now operates on filtered images only ([58f94f6](https://github.com/bcit-tlu/hriv/commit/58f94f69b1029698ca15e6764b7d17cec954ba47))
* stack share-link snackbar above processing snackbars to prevent overlap ([b20585b](https://github.com/bcit-tlu/hriv/commit/b20585b0cddc63bb9bd903538e29b4ad30794efd))
* sync categoryId state when upload modal reopens with new prop ([f92e5b4](https://github.com/bcit-tlu/hriv/commit/f92e5b472c0d8ab82889fc8406cd1bbf9b9ddc56))
* sync program dropdowns across all modals by lifting state to App ([ed767f9](https://github.com/bcit-tlu/hriv/commit/ed767f9e746599c9ce85da3d648ffe7f744c8b4f))
* track active switch changes to allow bulk reactivation ([8fdf84c](https://github.com/bcit-tlu/hriv/commit/8fdf84c37eba16e1bdf7295328f4a3372a1fb840))
* track category picker changes to allow uncategorizing images ([7559826](https://github.com/bcit-tlu/hriv/commit/755982699560db2fb71a6321b1f8917ede786022))
* track uncategorized images load state and clean URL for non-existent images ([13dd852](https://github.com/bcit-tlu/hriv/commit/13dd852ebfa38ce374619502a0fd4da9720039ba))
* unlock only re-enables clear button, does not remove metadata ([8cbde72](https://github.com/bcit-tlu/hriv/commit/8cbde72b52caaa7a19171b0e5fc5163992ffce3d))
* unmount CardImagePickerModal when closed so selection re-syncs on re-open ([8732f21](https://github.com/bcit-tlu/hriv/commit/8732f21b501f22faaf8efbdbec0e5f9e774d43e1))
* update BulkImportModal help text "label" → "name" to match rename ([43a8e49](https://github.com/bcit-tlu/hriv/commit/43a8e496af9f3d420096debd944648f79f86dfbd))
* update remaining ImageItem/ApiImage references to use name/note ([d142902](https://github.com/bcit-tlu/hriv/commit/d142902e0fa94ba4408fd74916dc52e0e122f667))
* use #DAC7B5 background for admin/people pages to differentiate from browse ([f261cc6](https://github.com/bcit-tlu/hriv/commit/f261cc66876cfff417b3b772e9a23039e27b8c13))
* use backend instance epoch instead of sessionStorage for session invalidation ([d4c921f](https://github.com/bcit-tlu/hriv/commit/d4c921f440d67306bac1fb2534635d8aef2688bb))
* use center pivot for text/link view-mode rotation ([53d912a](https://github.com/bcit-tlu/hriv/commit/53d912a95aa1ebef8cfc00cacb4081c1d1d6704c))
* use cluster-internal FQDN for backend URL and fix envsh permissions ([6c8af6d](https://github.com/bcit-tlu/hriv/commit/6c8af6d526bc4c9daf9f8cf90ff9eb767da81db9))
* use CSS padding for category dropdown indentation instead of text spaces ([967da7d](https://github.com/bcit-tlu/hriv/commit/967da7d6808afa0469f046e9d8ca280b3d256a28))
* use image categoryId instead of nav path, refresh selectedImage after save ([bdfbce1](https://github.com/bcit-tlu/hriv/commit/bdfbce19e8c42f2ba6622f5c0bc553b895a7dc81))
* use image width for both height and width measurement conversion ([2041705](https://github.com/bcit-tlu/hriv/commit/2041705ffcfb054aa8520a8aff02459bd44d7904))
* use origin-based rotation pivot for all view-mode annotation types ([46bb84a](https://github.com/bcit-tlu/hriv/commit/46bb84ad0813d8a1eec2e3165070c0e44090b69a))
* use outline with negative offset to render border on top of button images ([4f773d9](https://github.com/bcit-tlu/hriv/commit/4f773d998027816e0c6eec512a3e972826489c94))
* use overlay box red for active-state toolbar border color ([a5614fc](https://github.com/bcit-tlu/hriv/commit/a5614fc96ffd1b193791d00ce8b4e8ab9dd690da))
* use palette color and inset box-shadow for active toolbar buttons ([3ba99cc](https://github.com/bcit-tlu/hriv/commit/3ba99cc79fcc5715f7c8060e82a964dd24bc1607))
* use ref instead of stale state in flushCanvasAnnotations ([e9188d1](https://github.com/bcit-tlu/hriv/commit/e9188d1a3267c6503646a776f07a02ff18001a89))
* use token-based download for file export to avoid browser memory exhaustion ([9c36bbe](https://github.com/bcit-tlu/hriv/commit/9c36bbe1225d5035b9c30be50082568c7fbff33c))
* wrap XHR load handler in try/catch to prevent hanging promise on parse error ([9d1fcbf](https://github.com/bcit-tlu/hriv/commit/9d1fcbf86108662d8e4c998e754eaac7f512d776))


### Performance Improvements

* optimize frontend Dockerfile with Alpine base (507MB → 417MB) ([75e0622](https://github.com/bcit-tlu/hriv/commit/75e0622ab5f8c97e0c5b72a170627b6db240ae50))
