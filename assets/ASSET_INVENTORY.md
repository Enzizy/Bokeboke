# Asset Inventory

All packs are **CC0 1.0** (Kenney "Mini" packs plus KayKit "Fantasy Weapons Bits") (commercial use allowed, credit
optional). Nothing in this folder is modified by the project. Only the `Models/GLB format/`
folders are loaded; FBX and OBJ are identical duplicates and are ignored.

## Facts that the code relies on (measured from the GLB files)

- **Grid unit = 1.0.** Floors, walls, stairs, ramps have a 1x1 footprint; walls are 1.0 high.
  Origin is at the base centre, so a piece at (x, 0, z) covers x±0.5, z±0.5 and stands on y=0.
- **Characters are 0.67-0.84 units tall** (chibi, about two thirds of a wall).
- **Textures are external.** Every GLB references `Textures/colormap.png` next to it, so the
  folder layout must be preserved when serving. All colormaps are 512x512 palettes sampled
  with nearest filtering. Characters/Arcade/Market share one colormap; Arena, Dungeon,
  Forest and Skate each have their own. Some packs ship `Models/Textures/variation-*.png`
  recolours (swap the material map to use them).
- **Orientation** (from vertex data): `wall`, `border-straight` run along X at rotY 0;
  `border-corner` fills the -X/-Z corner; `stairs` rise toward -Z; `stairs-corner` is high
  in the -X/-Z corner.
- **Weapon models are measured before use**: slice the mesh along Y and look at the radius of
  each slice - the thin run is the handle, the fat run is the business end. That gives both the
  `grip` point and a `scale` that reads next to a 0.72-unit character.
- **KayKit weapon origins are mid-shaft**, not at the grip: `hammer_B` runs y -0.47..1.04 with
  its handle below 0.28 and its head above 0.41, and `staff_B` runs -0.86..1.45 with the crystal
  above 0.68. Each weapon's `grip` in `weaponCatalog.ts` is measured from that.
- **The character rig binds in a T-pose**: `arm-left` extends along its local +X and `arm-right`
  along -X (about 0.28 long); animation clips rotate them down. "Arms up" is a rotation about Z.
- **Characters face +Z** at rest (verified: the kick clip swings the foot toward +Z). A yaw of 0
  looks down +Z; `rotation.y = atan2(dx, dz)` faces direction (dx, dz).
- No collision meshes are shipped. Colliders are derived in code (boxes from tile bounds).

## Characters - `characters/mini-characters` (26 models)

**Player skins (12):** `character-male-a..f`, `character-female-a..f`.

Rig, identical in every one: `root -> leg-left, leg-right, torso -> arm-left, arm-right, head`
(7 bones, two skinned meshes `body-mesh` + `head-mesh`). Rest pose: hips y=0.176,
shoulders y≈0.29, head y≈0.35.

Animations (32 each): `static` (bind pose), `idle`, `walk`, `sprint`, `jump`, `fall`,
`crouch`, `sit`, `drive`, `die`, `pick-up`, `emote-yes`, `emote-no`, `holding-right/left/both`,
`holding-*-shoot`, `attack-melee-right/left` (punch), `attack-kick-right/left`,
`interact-right/left`, 7x `wheelchair-*`. No hit-reaction / knockdown / get-up clips - the
ragdoll physics covers those.

**Extra skins inside map packs** (same rig, core 25 anims): `character-soldier` (arena),
`character-skate-boy/girl` (skate, +`skate*` clips), `character-employee`, `character-gamer`
(arcade), `character-employee` (market), `character-human`, `character-orc` (dungeon),
`character-archer` (forest).

**Accessories (cosmetic, unused for now):** `aid-cane*`, `aid-crutch`, `aid-glasses`,
`aid-sunglasses`, `aid-mask`, `aid_hearing`, `aid-defibrillator-*`, `wheelchair*`.

## Map packs - `maps/<pack>/`

Legend: **S** static collider, **D** decor (no collider), **P** dynamic prop candidate,
**A** has baked animation.

### arena (Mini Arena) - first prototype map
S `floor` (2 tris), `floor-detail`, `wall`, `wall-corner`, `wall-gate`, `border-straight`,
`border-corner`, `block` (1x0.5x1), `stairs`, `stairs-corner`, `stairs-corner-inner`,
`column`, `column-damaged`, `statue` (1.34 tall), `weapon-rack`.
D `banner`, `tree`. P `bricks`, `trophy`, `weapon-sword`, `weapon-spear`.

### skate (Mini Skate) - ramps and elevation
S `floor-concrete`, `floor-wood`, `half-pipe`, `bowl-side`, `bowl-corner-inner/outer` (0.8 high,
curved), `steps`, `obstacle-middle/end`, `structure-platform`, `structure-wood`,
`rail-low/high/slope/curve` (thin; `rail-curve` and `obstacle-end` have off-centre origins).
P `pallet`, `skateboard`, `obstacle-box`.

### arcade (Mini Arcade) - tight spaces, machines
S `floor`, `wall`, `wall-corner`, `wall-window`, `column`, machines: `arcade-machine`,
`pinball`, `air-hockey`, `dance-machine`, `gambling-machine`, `basketball-game`,
`vending-machine`, `cash-register`. A `wall-door-rotate` (1.5 wide, open/close),
`claw-machine`, `prize-wheel`, `ticket-machine`. P `prizes`.

### market (Mini Market) - shelves and throwables
S `floor`, `wall*`, `column`, `fence`, `shelf-bags/boxes/end` (0.8 tall), `freezers-standing`,
`display-bread/fruit`, `cash-register`, `bottle-return`. A `wall-door-rotate`,
`fence-door-rotate`. P `shopping-basket`, `shopping-cart`, `freezer`.

### dungeon (Mini Dungeon) - narrow paths, hazards
S `floor`, `floor-detail`, `dirt` (solid block), `wall` (1.1 tall), `wall-half`, `wall-narrow`,
`wall-opening`, `stairs` (0.9 rise), `rocks`, `wood-structure`, `wood-support`, `column`, `table`.
A `trap` (spikes show/hide - hazard), `gate`, `chest`. D `banner`.
P `barrel`, `pot`, `potion`, `chair`, `coin`, `key`, `shield-round`, `shield-rectangle`,
`weapon-sword`, `weapon-spear`.

### forest (Mini Forest) - bridges, cliffs
No flat floor tile: ground is `patch-grass` / `patch-dirt` (0.1-0.17 thick).
S `platform`, `building-platform`, `bridge`, `rocks-high/low/ramp`, `ladder`,
`building-structure`, `building-roof`, `fence`, `tent`, `tree`, `tree-high`.
D `flag`, `plant`. P `stones`, `target`, `weapon-bow`, `weapon-arrow`.

## Not provided by these packs
UI graphics, skybox, audio. The sky is a flat colour per map (fits the style).

## Weapons - `weapons/KayKit_FantasyWeaponsBits_1.0_FREE` (31 models, KayKit, CC0)

Loaded from `Assets/gltf/<name>.gltf` (+ `<name>.bin` and the shared 1024x1024
`weapons_bits_texture.png` in the same folder, so the folder must stay intact). The fbx, fbx(unity)
and obj folders are duplicates and are ignored. Linear texture filtering (it is a gradient atlas).

**Scale:** modelled for ~1.8-unit humans - a sword is 1.8 units, a staff 2.3, a bow 2.4 wide.
Every `WeaponDefinition` carries a `scale` (~0.4 normal, ~0.8 "mega"). Grip is at the origin,
blade/head along +Y; bows lie along X.

- **Bows:** `bow_A`, `bow_A_withString`, `bow_B`, `bow_B_withString` (+ `arrow_A`, `arrow_B`)
- **Staffs:** `staff_A` (plain), `staff_B` (crystal magic staff), `wand_A`
- **Hammers:** `hammer_A` (spiked mace), `hammer_B` (flanged mace), `hammer_C` (square warhammer)
- **Other:** `sword_A..E`, `dagger_A/B`, `axe_A/B/C`, `spear_A`, `halberd`, `shield_A/B/C`,
  `fistweapon_A/B` (+ `_stacked`)

Used now: `bow_B_withString` (Magic Bow), `staff_B` (Fireball Staff), `hammer_B` (Mega Hammer),
`arrow_A` (arrow projectile). The fireball and explosion are procedural (no asset).

## Chaos Crate
No crate model is shipped in any pack. The crate is built procedurally from Three.js boxes in
`client/src/render/crateGeometry.ts` (panels, frame, X-braces, metal caps) so it can break apart.
