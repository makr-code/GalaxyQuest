# Earth inspection data

Development-only inspector: run `npm run vite:dev`, then open
<http://127.0.0.1:8080/tools/earth-reference.html>.
This is not a production Vite entry or a replacement for procedural planets.

## Sources

Made with [Natural Earth](https://www.naturalearthdata.com/).
Both vendored GeoJSON files are public domain under the
[Natural Earth terms of use](https://www.naturalearthdata.com/about/terms-of-use/).
No network connection is needed after starting the local development server.

- [Land, 1:110m](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson):
  127 Polygon features, SHA-256
  `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`.
- [Lakes, 1:110m](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_lakes.geojson):
  24 Polygon features, SHA-256
  `eb02ecc86c82004fccbf979058bfabbbd6c2d07968c7844d38eb1c9152d2ffc9`.

The hashes pin the actual downloaded bytes; upstream `master` may change.
Do not silently regenerate or simplify these files.

### ETOPO elevation and bathymetry

The default production view uses **ETOPO1 Ice Surface** (NOAA NGDC, 2009),
obtained from the [PacIOOS ERDDAP mirror](https://pae-paha.pacioos.hawaii.edu/erddap/info/etopo1_ice/index.html).
Source citation: Amante, C. and B. W. Eakins, 2009, *ETOPO1 1 Arc-Minute Global
Relief Model: Procedures, Data Sources and Analysis*, NOAA Technical Memorandum
NESDIS NGDC-24, [doi:10.7289/V5C8276M](https://doi.org/10.7289/V5C8276M).
This is ETOPO1, **not ETOPO 2022**.

The mirror permits free use and redistribution, with no warranty of accuracy
or fitness for legal/navigation use. The original source includes bathymetry
and top-of-ice elevations, rather than subglacial bedrock.

The compact local `etopo1-ice-30arcmin.i16` stores signed little-endian Int16
metres, positive up relative to sea level, in latitude-major order:
721 longitudes from -180 to +180 and 361 latitudes from -90 to +90,
both inclusive, step 0.5 degrees. Byte length 520,562, SHA-256:
`2c5613d1f94b89ce28bf98d8aa749604dd0091c70bcaf5f42c37ea65d734001d`.
The browser verifies the checksum before building any GPU resources.

Reproduce deliberately with `node scripts/fetch_earth_relief.mjs`. It requests
`z[(-90):30:(90)][(-180):30:(180)]`, taking every thirtieth node of the original
one-arc-minute raster. **This is subsampling, not averaging or preservation of
local extremes.** The script checks coordinate order, units, schema, complete
coverage and valid metre values before writing. Review the printed checksum
before accepting refreshed source bytes.

The CPU sampler decodes byte order explicitly and interpolates bilinearly.
Sixteen source latitude rows have dateline endpoints differing by one metre;
the sampler uses their mean at both seam endpoints (larger discrepancies fail).
Each pole uses its full longitude-row mean, ensuring one radius at the shared
polar vertex. These sampling reconciliations do not modify vendored bytes.

## Measured-relief inspection

Select **ETOPO1** in the production renderer. The same sampler drives mesh
vertex elevations, height-color texture, control-point readings and sea
classification. Geometry-only classifies water from interpolated signed
elevations using the production `gqTerrainMasks`; texture-only classifies the
independently sampled raster on a unit sphere. Combined mode displaces the
mesh and uses the height raster's colors and water mask.

`radius = 1 + displayedElevationMeters * exaggeration / 6371008.8`.
Exaggeration (1/5/10/20/40x, default 10x) affects geometry only, not measured
metres, texture colors or water classification. With the sea visible, each
vertex is clamped to at least the selected sea datum (-500/-100/0/+100/+500 m).
Disabling the sea shows raw seafloor elevations and disables liquid
classification, even though depths retain blue hypsometric colors.
This is a coarse triangulated ocean surface, not a separate fluid simulation.

The sea datum is an elevation threshold, **not flood connectivity, lake-level
hydrology or a sea-level prediction**. Natural-Earth lake/coast polygons are
not layered over the DEM: their different resolution/datum would produce
contradictory coastlines. Switch data sources for the vector-coast comparison.
The source raster is about 56 km per longitude cell at the equator and the
production 32/64/128-row mesh is coarser still; neither preserves individual
mountain peaks, deepest trench points, narrow islands or fine shorelines.
Increasing display texture resolution cannot recover missing measurements.
Light height colors indicate elevation, not measured snow or biome.

Himalaya/Tibet, Andes and Mariana camera presets include interpolated
control-point heights. These refer to the named preset coordinate, not the
current center after manually rotating the camera. The baseline renderer
remains the Natural-Earth polygon reference without DEM; relief controls are
disabled there. Production procedural planets and gameplay are unaffected.

### Point inspection

Click the globe in the production ETOPO view to inspect a point on the actual
uploaded 48-byte triangle mesh. The screen ray uses the camera's current
projection (including overlay offset) and inverse body orientation. The
nearest triangle intersection, not an ideal sphere, determines longitude,
latitude and displayed radius. No duplicate geometry buffer or GPU picking
pass is allocated.

The readout separates interpolated ETOPO source metres, the expected
sea-clamped height and mesh-derived height after dividing out exaggeration.
The difference includes coarse vertex sampling, triangle interpolation and
the inward radial sag of straight triangle chords; it is not a measurement
of ETOPO accuracy. In texture-only mode no relief error is reported because
the visible unit sphere deliberately has no physical relief.

Results are snapshots at click time, including the then-current LOD and
orientation. Water labels use the CPU ETOPO threshold, not a GPU pixel
classification or hydrological decision. Dragging more than five CSS pixels
at any point suppresses inspection, even if the pointer returns to its start.
Secondary/multiple pointers and cancelled gestures do not select a point.
Changing inspection settings, camera presets, viewport size or reference time
clears the result. A miss is shown explicitly. Baseline/vector views do not
pretend to support measured-relief picking.

### Fixed mesh detail

The ETOPO-only mesh selector keeps automatic production LOD as the default,
or pins 32, 64, 128 or 180 latitude rows independently of zoom. Automatic LOD
retains its own previous resolution so returning from 180 rows cannot feed
an unsupported resolution into production hysteresis. Vector/baseline modes
disable the selector; returning to ETOPO restores the chosen setting.

180 rows produce 1-degree cells, 129,600 triangles and 18,662,400 vertex
bytes (about 17.8 MiB), still inside the shared 32 MiB CPU mesh-cache budget.
This is not the full 0.5-degree source grid and does not add source detail.
Measurements identify their mesh resolution and clear on detail changes.
The controlled 87 E / 30 N, 20x comparison reduces the roughly -494 m error
at 64 rows to under 0.1 m at 180 rows because that coordinate becomes a
mesh vertex. This is a mesh-versus-source result, not sub-metre Earth accuracy;
more triangles do not guarantee monotonic improvement at every location.

## Natural-Earth inspection contract

The same longitude/latitude polygons supply the triangulated land surface,
lake surfaces, coastline lines, texture raster and CPU control-point queries.
Greenwich is +X, 90 degrees east is -Z, north is +Y. The production rotation
basis is conjugated by the Z reflection (`S * basis * S`) to preserve prograde
spin while avoiding a mirrored globe. Production terrain conventions are not
changed by this isolated reference.
Baseline triangles are subdivided in geographic coordinates to at most
3-degree edges; production-mode authored meshes use 6 / 3 / 1.5 degrees.
Antarctica's pole closure and +/-180-degree seams remain authored coordinates.
The 2048 x 1024 texture has approximately 0.176-degree texels; linear filtering
can soften sub-texel shores, but no procedural noise can relocate continents.
Small islands absent from Natural Earth 1:110m are intentionally absent.

Switch between **geometry + texture**, **geometry only**, and **texture only**
to detect UV mirroring, coordinate offsets, coast cracks and wrong land/water
classification. In the baseline renderer, wireframe, coast overlays and
latitude circles are independent. These overlays are disabled in production
mode rather than pretending they belong to the production pipeline.
Check Africa, the Americas, Asia/Australia, the Pacific seam and both poles.
Lakes are explicit water meshes just above the land surface, not DEM-cut basins.

The Earth reference uses the production `PlanetLivingWorld.bodyOrientation`
basis with a 23.9344696-hour sidereal period, 23.43928-degree tilt, fixed J2000
reference time and an explicit fixed light direction. Rotation is opt-in and
advances at real-time speed. This is not a precise Earth ephemeris or a weather
simulation. The baseline atmosphere is a translucent inspection shell, not
physical Rayleigh/Mie scattering; it is exaggerated to 2.5% of the radius.
Production mode uses the actual planet renderer's rim contribution.
In Natural-Earth mode only, continents are raised by a constant 0.4% instead
of using DEM height.

The ice/tropical/temperate/desert colors are **schematic inspection masks**.
Tropics and polar circles follow the stated axial tilt. Greenland and major
desert regions are rough authored masks clipped to land, not satellite colors,
Koeppen classes or measured seasonal ice. Open polar seas remain water.
The baseline view has no clouds; production clouds are seeded, procedural
and optional, not measured Earth weather.

## Production renderer

The default mode instantiates the actual
`PersistentBodyPlanetApproachRenderer` on the same borrowed GPU device as the
baseline. It uses `body-material.js` (`gqTerrainSurface`, `gqWaterSurface`,
`gqDirect`, `gqFinish`, `gqCloudNoise`) and the same frame/material uniforms,
depth buffer, physical orientation and view lifecycle. The alternate baseline
remains selectable to isolate geography errors from production shading.
Both canvases share one frame callback; only the selected backend renders.

An opt-in `backend.geographicSurface` supplies a borrowed albedo texture view,
sampler, 16-byte inspection-options uniform and stable-keyed meshes in the
existing 48-byte vertex layout. Only that pipeline variant adds the texture
bindings. RGB stores authored color; alpha stores water=0, dry land=0.5,
ice=1. The Natural-Earth geometry-only comparison uses per-triangle mesh
material classification and neutral colors, independently of the texture mask.
The ETOPO variant instead uses the vertex signed-height boundary channels.
The ordinary production path retains its existing signed-height boundaries.
No untrusted scene payload can enable this backend-only adapter.

The renderer accepts a validated external view-projection matrix plus its
projected scale when external camera control is enabled. An optional backend
Unix-seconds function makes fixed-time reference views deterministic without
changing the normal client clock. In the authored -Z-east coordinate frame,
the fixture passes the negated sidereal period, which implements the same
`S * basis * S` conversion as the baseline, not a retrograde physical Earth.

The authored mesh adapter uses the production `terrainSphereResolution`
thresholds and 15% hysteresis (32/64/128 rows). It evicts least-recently-used
CPU meshes above 32 MiB; the renderer releases the previous GPU vertex buffer
on mesh-key changes. The adapter owns its albedo/options resources, while the
renderer borrows them and the device. Exiting/disposal must not destroy the
borrowed GPU device. The inspector owns and finally destroys that device.

Controls independently gate cloud coverage, atmospheric strength, lighting,
water normal contribution and animation. Reduced-motion preferences remain
effective through the real production policy. At an Earth-size body's orbital
distance, the production material intentionally filters out metre-scale water
normal animation. This fixture does not exaggerate wavelengths or claim
visible orbital ocean waves.

### Textures, bump, specular and sky

The ETOPO albedo selector preserves height colors for measurement or uses
the existing schematic climate masks with exposed-rock color blending.
Only RGB changes; ETOPO sea classification, mesh vertices and source heights
remain identical. These colors are not satellite imagery or measured land cover.

An optional `geographicSurface.appearance` supplies the authored variant with
a borrowed material texture and 32-byte options uniform (bindings 7 and 8).
Two aligned vec4 fields hold material/mode flags and cloud radius/shadow flags.
The 1024 x 512 `rgba16float` map stores **east slope, north slope, roughness,
dielectric F0** in linear channels. Central differences use the 0.5-degree
DEM sampling interval and Earth-radius metre distances, with longitude
wrapping, bounded latitude and a polar gradient fade. Ocean heights
are clamped before differentiation; open water has no terrain bump.
The map uses 11 CPU-averaged mip levels with linear/trilinear filtering
(about 5.33 MiB GPU storage); signed slopes and linear material values are
averaged without sRGB conversion. Wrapped longitude derivatives avoid an
artificial minification seam at the dateline.

The shader reconstructs normals in the authored -Z-east canonical frame.
The bump selector (off, 1x, 10x, 40x) is independent of geometry exaggeration.
It replaces the land shading normal, not vertex positions or the picking
mesh. Geometry-only mode retains geometric normals. Vector coast mode
has no DEM bump. This does not invent small-scale terrain or increase DEM
resolution. The map contains no detail finer than the source.

Roughness/F0 are explicit illustrative material assumptions:
water 0.16/0.02, dry land 0.88/0.04, schematic ice 0.38/0.04.
Exposed seafloor is dry material, not glossy water. High elevation in the
height palette is still not measured snow. The shared `gqDirectF0` implements
the existing GGX BRDF with supplied dielectric F0; ordinary `gqDirect` still
uses the original 0.04 and ordinary planets receive no new map bindings.
The gloss-off comparison uses roughness 1 and the original dielectric F0;
it is not a switch disabling every physical reflection.

Material diagnostics show unlit albedo, object-space normals, raw linear
roughness or raw linear F0. They bypass surface lighting, clouds and rim
color; F0 is intentionally dark (0.02 is about 5/255). These are not new
geographic or climate data. Albedo legend selection follows the palette.
By default these remain terrain-map diagnostics. The opt-in
`Stadtmaterialien in Pruefansichten einbeziehen` checkbox instead inspects the
composed surface after the shared colony shader: sRGB-encoded roof/land albedo,
canonical shading normals (including resolved roofs) and linear roughness.
F0 remains the authored dielectric value because cities do not change it.
Emission, direct lighting, clouds and atmosphere are still excluded; power
and solar direction do not affect diagnostic output. The checkbox is disabled
in shaded, geometry-only, vector and baseline views, and does not change the
shaded rendering path. Turning it off restores the original terrain diagnostics
exactly. It uses an unused appearance-uniform component, with no extra buffer,
texture, pass or persisted data. Population playback remains paused while
inspecting materials; select development year/profile in the shaded view first.
The city-light GPU test checks all four modes at roof-resolving camera scale,
including restored terrain pixels, power/sun isolation and unchanged meshes.

The adapter-owned fullscreen sky draws before the planet in the same GPU
pass/device, without depth writes or an extra frame loop. Camera inverse
projection produces world-space rays for seeded procedural stars and a
light-aligned solar glow. A day-weighted analytic spherical limb halo is
controlled by the atmosphere toggle, independently of the sky toggle.
It is a visual approximation at radius 1..1.035, not Rayleigh/Mie transport,
a measured star catalogue, terrain-following atmosphere or Earth ephemeris.
No sky twinkle, fabricated weather, fictional lava or fires are introduced.

The solar-atmosphere comparison (default on) shares `gqOrbitalAtmosphere`
between the authored planet rim and external sky halo. A radial normal/light
cosine weights blue daylight and a warm terminator band, fading to zero on
the deep night side. Turning it off restores the prior blue rim and
day-weighted halo with residual night glow. The atmosphere master toggle
still removes both; material diagnostic views bypass them. No geometry,
textures or resource allocations change when toggling this comparison.
This is an artistic tint/weight model, not wavelength-dependent optical
depth, Rayleigh/Mie phase functions, solar refraction or a computed sunset.
The existing exaggerated 1.035-radius halo envelope remains unchanged.
Ordinary planets retain their original rim behavior.

Clouds retain shared production turbulence. Shell mode projects their shade
along the sun direction; the legacy mode retains local surface shade. The phase
selector exposes the existing 120-second seamless loop; 120 s wraps to 0 s.
Pausing freezes the phase; unrelated setting changes do not reset it.
The production motion policy continues to respect OS reduced-motion and
document visibility. Metre-scale ocean normals stay distance-filtered in orbit.
The adapter owns/destroys material, appearance and sky resources; the planet
renderer borrows them. No production gameplay payload enables these options.
The shared morphology uses seeded continuous 3D fields for large cloud
envelopes, rounded billows and fine erosion, plus warped frontal ribbons.
This replaces the conspicuously periodic two-wave pattern. Individual scales
fade with footprint, preserving the existing seamless animation loop and
longitude/pole continuity; unresolved density converges to the same average.
The shell uses exponential optical-opacity mapping and thickness-dependent
daylight tone to distinguish wispy edges from denser fields.
These are illustrative cloud forms, not measured satellite imagery or a
weather simulation. Clouds remain a single depth-tested spherical sheet:
no volumetric cumulus towers, separate altitude layers or physical scattering.
GPU checks measure clear gaps, adjacent dense cloud samples, multiscale
detail, seed changes, filtering and loop/seam continuity. Shadow checks use
an independent lattice-noise oracle including the projected pixel footprint.
The Earth sheet adds approximate internal shading by sampling the same field
toward the sun along its surface. A denser sunward neighbour darkens local
daylight, more strongly under oblique illumination; overhead sun gives no
additional attenuation. The factor is bounded to 0.55-1 and fades out with
distance. Clear/deep-night/unlit/unresolved pixels skip the extra density
evaluation. Alpha, shell depth and terrain-shadow coverage are unchanged.
This adds apparent relief, not a physical volume or a new altitude layer.
GPU tests compare to an otherwise identical flat shader, measuring daylight
darkening, no artificial brightening, unchanged unlit output and bounded
helper values against an independent scalar calculation.

### Metre-scale 3D city inspection

The opt-in Berlin reference quarter uses real Earth-normalized metres:
`worldLength = metres / 6,371,008.8`. Its 24 by 24 candidate parcels have 60 m
spacing across 1.44 km; up to 576 deterministic building boxes occupy a
population-dependent subset. Residential buildings are 9-42 m tall,
industrial halls 9-18 m and trade buildings up to 96 m. Science alters the
palette. These are bounded cosmetic samples, not Berlin buildings, a complete
city census or an authoritative construction simulation. Population comes
from the shared planner's Berlin core allocation; growth adds fixed lots
without changing existing metre dimensions for a fixed economic profile.

The inspection button enables geometry, freezes motion/rotation, removes
clouds and the orbit-only sky/limb atmosphere, selects 1x relief and the
180-row mesh, and moves the camera 2 km above
the mean mesh foundation radius. Mouse orbit/zoom operates around that local
surface target with a distance-adaptive near plane. Selecting a region or resetting restores
the globe-centred orbit camera and its original near plane.
During free zoom, the near plane follows one percent of the distance
to the navigation target, bounded between 1 m and 0.01 Earth radii.
This keeps metre details accessible nearby without retaining a 1 m near
plane in orbit, where 24-bit depth quantization otherwise lets back-side
triangles compete with the visible terrain and produces black patches.
The production planet shader normalizes the scale of its position derivatives
before computing face normals. This preserves unit-length normals on close
metre-scale terrain instead of shrinking them with an absolute face-area
epsilon; degenerate faces use the interpolated normal.

Each foundation samples the actual rendered DEM triangles at its centre and
four footprint corners, rejecting wet/missing samples. Foundations span the
local mesh slope; the roof remains the requested physical height above the
highest sampled foundation. DEM heights and buildings are not multiplied
together: relief exaggeration affects terrain only. This avoids floating over
an ideal sphere, but the 0.5-degree DEM and 1-degree mesh are not suitable for
survey-quality street terrain. The quarter uses metre-scaled flat-faced boxes
and filtered window patterns, not detailed architectural assets, roads or
building self-shadows.

One lazy instanced pipeline, a 128-byte frame buffer and bounded 80-byte
building records share the planet's device, pass and depth buffer. Buildings
draw before clouds. Projected building heights below 0.75 pixels skip the
draw; orbital city textures remain the distant representation. The default
off state allocates no city GPU buffers. Geometry rebuilds only when mesh,
population or profile changes; disposal releases owned buffers. Diagnostics,
vector, geometry-only and baseline views omit the quarter. CPU tests verify
metre conversion, stable growth, dry-land foundations and bounds; GPU tests
verify 2 km camera distance, near-view pixels, repeatability and zero orbital
pixel changes. External projections now receive their actual camera eye,
without the former 1.04-radius minimum used by automatic orbit framing.

### Metre-scale terraced mining inspection

The optional synthetic Lausitz basin at 14.3 E, 51.8 N is about 4 by 3 km
wide and 240 m deep. A fixed seed perturbs its elliptical rim; eight 30 m
stages have broad shelves and smooth steep risers, with alternating sediment
colours and a dark floor. This is actual radial excavation of the rendered
terrain, not a painted depression or floating overlay. Depth remains 240 m
even when terrain exaggeration changes.

`earth-reference-mine.js` adaptively subdivides nearby source triangles until
their tangent-space edges are at most 50 m, with a recursion limit. Midpoints
remain on the original triangle planes outside the excavation. The mesh and
LRU cache retain their 32 MiB bounds; switching mine geometry can evict and
deterministically reconstruct the original or excavated mesh. This uses the
existing planet pass and buffers, without another draw pass, GPU texture or
server record. A flooded reference anchor disables excavation.

The inspection button selects 1x relief, 180 rows and the surface palette,
disables authored DEM bump, freezes motion/rotation, removes clouds and the
orbit-only sky/limb atmosphere, then targets the actual pit floor from 5 km
with the same distance-adaptive near plane. Region selection/reset restores globe navigation.
Excavated regions retain their strata albedo, geometric normals and rough
material instead of inheriting the coarse DEM's bump. Default diagnostic
views still inspect authored maps; enable composed city-material diagnostics
to include the excavated surface material.

This fixed cosmetic reference is not a reconstruction of a real mine.
The coarse DEM is not survey terrain; there is no geological model,
groundwater, extraction-volume calculation, equipment, access ramp or
capacity-driven mining lifecycle yet. No additional authoritative simulation
or persisted mining history is introduced.

### Shared facility classes and physical geometry

The reference now exposes 16 families: outdoor agriculture, protected
hydroponics, industry, warehouses, tanks/process vessels, food silos, solar,
fusion, research, nanotechnology, hospitals, schools, administration,
security, terraforming and drilling. Select a family and use the facility
inspection button for a 1 km view, or inspect all families together from 8 km.
The synthetic stock selector uses levels 0/1/3/7/16; these are not real Berlin
facilities or economic capacity measurements.

The production `colony-surface-plan.js` maps completed authorized surface
building rows to these same families, including processing recipes.
`orbital` and `star_orbit` rows never become ground facilities. Habitats and
open-pit mines retain their separate representations. A fixed primary-site
district gives every family a stable plot, independent of owner, camera,
population and other families. Adding levels activates up to three fixed
modules (`ceil(log2(1 + completedLevel))`, capped at three), without enlarging
or repositioning existing pieces. This deliberately bounded visual stock is
not the number or production rate of actual gameplay buildings.

Boxes, gabled sheds/greenhouses, twelve-sided cylinders and tilted solar
rows have metre dimensions. Flat crop parcels and access ways follow terrain
in the shared surface shader. The *same* component footprints, colours,
row patterns and perimeter lighting feed the planet/colony surface material
and the instanced solids in the production planet-approach renderer.
Far-subpixel components fade, rather than being made artificially huge in
orbit. Coverage includes both component widths so unresolved fences/roads
cannot expand into broad painted strips; tank footprints use the same
twelve-sided outline as the solid mesh. Soil/crop parcels and solar panels themselves remain unlit.
Perimeter/access lighting is night- and colony-activity-gated; the inspector's
city-light checkbox controls facility power too.

`colony-facility-geometry.js` samples the actual rendered triangle mesh at
each centre/four corners, excluding water, lava, authored regions and steep
foundations. Solids extend into the sampled ground; roof height remains the
requested number of metres above the highest sampled corner. Foundations
also use the reference's geographic water check. Geometry allocates lazily
only once physical heights resolve, caches by mesh and component plan, draws
in the existing depth pass before clouds, and releases owned buffers on
exit/disposal. The 16-family/384-part bound uses at most 36 KiB of instances.
The shared living-surface uniform is now 26,112 bytes; its original city and
road offsets are unchanged.

The reference switch defaults off to preserve previous inspection fixtures.
Geometry is omitted in diagnostic, vector and texture-only modes; composed
material diagnostics can inspect footprints. Existing interactive primary
colony building slots and satellite box geometry are not replaced by this
district layer: it is not a new construction UI or a complete continuous
street-level city. No machinery animation, transparent greenhouse optics,
building self-shadowing, environmental terraforming simulation or additional
server persistence is claimed. Native 3D facility solids currently belong
to the planet-approach path; the colony surface path shares their material
footprints while retaining its existing interactive building models.

### Geostationary objects

The default-off orbital switch supplies explicit synthetic stock: one
shipyard, one defence station (`missile_silo`) and three solar satellites.
Select a class and inspect it from approximately 1.4 km. The actual shared
production renderer constructs satellite buses/panels, station hubs/habitats
and open shipyard rails/gantries at metre scale; it does not enlarge these
meshes for the globe view. Shipyards have a small cosmetic service-shuttle
loop when motion is enabled, not an authoritative fleet or surface flight.

Earth mass and the sidereal day yield approximately 42,164 km centre radius,
or 35,793 km above this reference's **mean** 6,371.0088 km radius. This differs
from the familiar 35,786 km altitude measured from Earth's equatorial radius.
Objects lie on the rotating equator, so remain above a fixed body longitude.
The reference's negative rotation period is the existing authored-coordinate
conversion, not physical retrograde Earth.

Production consumes existing authorized orbital summaries, caps each class
at four deterministic representatives, excludes star-orbit installations,
and preserves old positions/dimensions as stock grows. Missing mass/radius
is explicitly unavailable; unsuitable synchronous orbits use physically
timed, clearly labelled Keplerian low orbits. The native orbital selector
provides close inspection and return to the planet overview. There is no new
gameplay station type or persisted orbital phase.

Objects participate in planet depth occlusion and use a simple spherical
umbra test for sunlight. No penumbra, self-shadows, N-body stability,
docking collisions or logistics simulation is claimed. Resolved geometry
uses the existing facility instance pipeline, bounded to 256 records/24 KiB
plus a 128-byte frame; animation reuses buffers and disposal releases them.
Turning motion off freezes service traffic, while planet rotation remains
controlled separately by the reference's rotation switch.

### Cloud shell and manual sunlight

The default authored cloud mode is a separate spherical layer. A fullscreen
analytic ray/sphere intersection draws **after** the terrain, with per-fragment
projected depth, a `less` depth test, no depth writes and premultiplied-alpha
blending into the existing unorm display target. The near shell surface uses
the current production body orientation, shared `CLOUD_WGSL`, seed, phase and
effect policy. Derivatives are evaluated before any intersection discard.
This needs one 224-byte uniform buffer, no tessellated cloud mesh, extra
canvas/device or independent animation loop.

The 12 km default is a physical radius offset, not a meteorological claim.
80/200 km are explicitly exaggerated inspection distances. Cloud altitude
is independent of terrain exaggeration and sea datum: exaggerated mountains
or a raised/exaggerated sea can pierce or occlude the layer. The same depth
buffer handles that intersection instead of forcing clouds in front of land.
The model renders the visible near sheet, not volumetric multi-layer clouds,
a far-side transparent atmosphere or local cloud fly-throughs.

The legacy surface-only white-cloud comparison remains selectable; it does
not also draw a shell. Only that legacy mode keeps local density shading.
Clouds are suppressed
in albedo/normal/roughness/F0 views. Cloud coverage is independently switchable
from the illustrative atmosphere halo.

World-space solar azimuth/elevation select one normalized light direction:
azimuth 0 points +X, 90 points +Z, elevation +90 points +Y. These are not
geographic solar longitude/latitude or an astronomical date. The same vector
feeds production terrain/specular lighting, cloud day/night brightness and
the sky sun/halo. Changing sun angles never changes mesh identity or source
heights. The baseline deliberately keeps its original fixed comparison light.
Shell opacity and density remain unchanged when moving the sun; night clouds
use a small illustrative ambient contribution, not physically dark transport.

### Projected cloud shadows

The shell-mode shadow toggle intersects a ray from each actual terrain
fragment toward the directional sun with the selected cloud sphere, in the
same canonical frame. Shared noise/coverage at that intersection uses the
shell's seed and loop phase. Shadow sampling computes its own projected
screen derivatives for distance filtering. Cloud altitude and oblique sunlight
therefore move the shadow instead of merely changing a local dark mask.
The foreground cloud layer is independent of this toggle.

Transmission is `1 - density * 0.55` and attenuates only the shared GGX direct
sunlight (including specular), not ambient light or emission. Shadow weight
fades from zero at the geometric night terminator to full weight at a radial
sun cosine of 0.12. Fragments at/above the cloud sphere do not receive its
shadow. Disabling clouds, lighting or using material diagnostics suppresses
the corresponding shadow effect. The toggle is disabled in baseline and
legacy surface modes; toggling it there does not change rendering.

This is a directional single-sheet density projection, not volumetric optical
depth, finite-sun penumbrae, atmospheric multiple scattering, or terrain
self-shadowing. The 0.55 strength and terminator fade are illustrative
appearance assumptions; the shell remains at its selected physical/inspection
altitude even when mesh relief is exaggerated. There are no additional
textures, buffers, frame loops or shadow-map allocations for projection.

This validates the production orbital shader with authored geography, not
the procedural geological generator, coastal refinement, terrain streaming,
gameplay surface picking, colony building meshes, economic overlays or combat
effects. No fictional lava or fires are added.

### Night-side colony-light inspection

The authored appearance path reduces ambient illumination from 0.3 in daylight
to 0.003 in deep night (linear light), with a narrow smooth twilight transition.
Direct lighting is gated by the radial solar cosine to prevent terrain bump
normals illuminating the far night side. Ordinary procedural planets retain
their existing lighting; emission remains independent of ambient/direct light.

ETOPO shaded/texture views also exercise the existing `GQColonySurfacePlan.plan`,
uniform packing and `gqLivingSurface` shader. Twelve named inland city anchors
use a deterministic, synthetic population fixture (120 million at default
development year 50) solely to size visible urban inspection footprints.
Neither population, footprint nor
block distribution represents real cities or measured night imagery. There
are no extra city textures, GPU allocations, timers or gameplay writes.
Anchors flooded by the selected sea datum are excluded; shared surface masks
also suppress urban shading/emission on water. No roads or economic activity
are fabricated. The independent city-light checkbox changes power only, leaving
daytime urban albedo and mesh unchanged. Unlit mode suppresses emission;
material diagnostics bypass it entirely. Geometry-only, vector and baseline
views do not receive a settlement plan. This tests orbital colony surface
patterns and night emission, not separate building meshes or gameplay.

The development slider scrubs two synthetic centuries continuously:
`population = 12,000,000 * 100^(year/100)`, spanning 12 million to 120 billion.
It feeds the existing colony planner, not a second settlement shader.
The twelve named anchors are regional reference centres, not the complete
city population. Each has up to seven deterministic DEM-validated potential
satellite sites; the number actually founded grows with population pressure.
New sites start small, not at the size of their older parent. A conservative
allocation divides the unchanged total population into rural residents,
regional cores and younger cities; more city centres never create inhabitants.
Radius grows with the square root of the residents allocated to each centre,
subject to the production planner's bounds.
Seeded irregular districts, central density and arterial growth provide the
spatial density gradient. Existing cores also densify: increasing extent in
fixed parcel units raises occupied districts and lit windows, especially with
trade/science, while agriculture reduces this effect. Fixed seeded open spaces
retain gaps; streets and parcels do not move. `URBAN_STRUCTURE_VERSION = 5`
identifies this cosmetic change without extra uniforms or persisted city ages.
GPU checks measure increasing light within the same already-built core,
not merely extra outer area, including deterministic reconstruction and
agricultural contrast. This is illustrative footprint growth and infill,
not a demographic simulation or daily migration of people
between the day and night hemispheres. Daytime urban albedo and night-time
emission share the same changing footprint; power does not alter population.

Beyond this range the production planner's urban cap relaxes for theoretical
overpopulation; nearby European centres can merge through widening infill.
The shared shader replaces disks with hierarchical streets, district gaps,
window clusters and a non-circular envelope. Profile controls supply synthetic
completed farm/factory/trade-centre/research-lab snapshots to the real planner.
Agriculture reduces urban occupancy, industry broadens blocks with warm light,
trade emphasizes arterial lighting, science shifts the palette cooler.
Within each city, fixed seeded preference fields vary these signatures
locally: warm industrial hall lighting, cooler science quarters and
trade-weighted arterials. Mixed profiles no longer give every district the
same light colour. Satellite cities have their own fixed preferences.
Preferences do not depend on population or time and fade to the economic mix
when districts become unresolved. GPU tests verify within-city colour range,
repeatability, seed variation and distant-view colour convergence, including
the production surface path. These are cosmetic districts, not additional
persisted employment or population records.
On the day side the same quarters also vary roof albedo and roughness:
smoother industrial hall roofs, lighter science buildings, cooler commercial
surfaces and dark, rough streets. Material detail fades to averages with
distance. Satellite materials follow their own parcel seeds; abandoned
footprints darken and become rougher without changing their geography.
Power and sunlight affect illumination, not these material properties.
No additional texture maps, GPU buffers or server records are needed.
This does not add building geometry or metallic reflection.
GPU checks cover profile differences, local roughness contrast, distant-view
convergence, power/day-night invariance, masked surfaces and ruined satellites.
Filtered analytic roof normals now add shallow parcel-aligned relief:
industrial halls have stronger, primarily single-axis pitch; science quarters
remain flatter. The slope vanishes at streets and before unresolved roof
detail can alias, and ruined roofs retain reduced relief. These normals affect
shading only: original terrain normals still control water/slope exclusion and
night-light gating. No mesh displacement, building self-shadows or real roof
height data are implied. GPU checks measure unit normal length, bounded tilt,
economic contrast, repeatability, smooth filter transitions, distant flattening,
masked surfaces and reduced relief on abandoned satellites.
The same production read model consumes authorized building snapshots in-game.
These are artistic signatures, not measured land use or real light spectra.
Urban infill is clipped by surface masks, not a pathfinding road or actual
server-side merger; remote centres remain separate.
Both inter-region and parent/satellite infill now use a fixed, seeded patch
strip rather than a full luminous capsule. Irregular district edges and lateral
bends remain anchored while growth first activates parcels near existing
centres, then closes more of the middle gap. Increased pressure never removes
already activated infill. The daytime built area and night lighting share this
mask. `URBAN_INFILL_VERSION` versions only this visual pattern: no candidate
IDs, founding thresholds, population budget or server data change.

Optional playback advances 200 synthetic years in 60 active seconds, stops
at year 200 without wrapping, and can be restarted by scrubbing backward.
It uses the existing render loop, limits resumed frame deltas to 0.1 seconds,
and observes the production visibility/reduced-motion policy and animation
checkbox. Playback pauses in diagnostic, geometry-only and vector views;
the separate Three.js baseline never advances it. The slider remains usable
for manual inspection with reduced motion. Solar/rotation/cloud clocks are
independent. Only colony uniforms change: terrain buffers and authored texture
maps are not regenerated during playback.

`tests/e2e/earth-city-lights-webgpu.spec.js` checks real GPU readbacks for
night-time Berlin emission, unchanged day-time Berlin, a >15:1 day/night
desert-patch RGB-sum contrast, deterministic power toggles, unchanged terrain,
and absence of emission in unlit/material diagnostics. Its numerical contrast
is a display-pixel fixture threshold, not a physical luminance measurement.
It also measures over eight times as many illuminated pixels at year 100
versus year 0, changed daytime urban pixels with identical day/night radii,
deterministic playback speed/end bounds, diagnostic/reduced-motion pauses,
and unchanged terrain buffers. `colony-urban-structure-webgpu.spec.js` separately
reads the actual shared shader to verify interior dark gaps and multiple
intensity levels, new light in the inter-city gap, different economic palettes,
stable seeds, and zero emission on water, protected regions, daylight or power
loss. It also checks new lights outside the original capital footprint and
non-emitting abandoned satellites. Unit tests independently verify population
conservation, continuous small time steps, fixed city IDs/locations, founding
thresholds, current/peak reconstruction and input validation.
The Earth growth test compares byte-identical uniforms and same-device pixels
after scrubbing away/back, counts additional founded cities, and verifies equal
elapsed playback under different frame subdivisions.
The shared infill GPU readback additionally checks progressive parcel occupancy,
per-pixel monotonic growth, deterministic replay, seed variation, small pressure
steps, filtering bounds, and zero coverage for invalid-length or rear-side
strips. This remains an artistic development-potential field, not a road or
barrier-aware city simulation.

No per-city data or new server fields are persisted. Region seed, model version,
population/building snapshots and the existing optional population peak
reconstruct the cosmetic pattern. This does not reconstruct actual historical
foundation dates or previous economic policies; the inspector's synthetic
year is only a way to select population pressure. A fresh client with identical
inputs produces the same city plan without replaying intervening frames.

## Validation

`npx vitest run tests/js/earth-reference-materials.test.js` checks physical
gradient signs/units, sea/bottom classification, seam/pole finiteness,
half-float channels, mip averaging, appearance validation and unchanged coasts.
`npx playwright test earth-materials-webgpu.spec.js` reads real GPU pixels
for bump/albedo/gloss/sky/halo changes, exact paused loop restoration,
diagnostic roughness/F0 values, unlit diagnostics, unchanged mesh buffers,
baseline/vector gating and OS reduced-motion behavior.

`npx playwright test earth-clouds-webgpu.spec.js` checks real cloud pixels
beyond the terrain silhouette, altitude/parallax changes, terrain depth
occlusion, isolated cloud day/night contrast, sun/mode restoration, unlit
diagnostic isolation and baseline control gating.
Its isolated-shadow test omits only the foreground cloud draw to read the
real terrain pass. It checks altitude-dependent displacement, darkening-only
direct transmission, phase restoration, no night/above-shell/unlit/diagnostic
shadow, and unchanged geometry. Selected GPU transmission samples are
compared against an independent scalar sun-ray/shared-noise oracle
(absolute density error below 0.04, allowing 8-bit readback quantization).

`npx playwright test earth-atmosphere-webgpu.spec.js` uses independent
camera-ray classification to measure blue day, warm twilight and absent
deep-night halo pixels. It also checks no added night-side surface rim,
legacy comparison/restoration, sun response, master-off/diagnostic isolation,
unchanged terrain buffers and baseline gating.

`npx vitest run tests/js/earth-reference-geography.test.js` checks pinned source
hashes, known continents/lakes/oceans, both sides of the Antarctic/dateline seam,
latitude-weighted global land share (28-31%), tessellation bounds and area
preservation including polygon holes.

With the Vite server running, `npx playwright test earth-reference.spec.js`
checks actual WebGPU pixels for every layer toggle, UV/position agreement,
screen east/north directions and all six camera presets. Geometry-only and
texture-only land/water masks must agree away from a two-pixel coast/silhouette
footprint (under 0.5% disagreement, over 8,000 sampled pixels per view).
It also checks real-time spin, resetting and idempotent disposal.

`npx playwright test earth-production-webgpu.spec.js` exercises the real
production renderer, comparing mesh-only and texture-only masks in all six
views with the same 0.5% threshold. Actual GPU readbacks verify lighting,
atmosphere, cloud coverage and turbulence differences, frozen/resumed
animation, LOD refinement, the 32 MiB cache bound, deterministic restoration
and borrowed-device survival after disposal.

`npx vitest run tests/js/earth-reference-relief.test.js` checks pinned ETOPO
bytes, known metre samples, bilinear interpolation, dateline/pole convergence,
exact exaggeration scaling, sea/bottom radius rules, texture classification,
triangle winding and malformed input rejection.

`npx playwright test earth-relief-webgpu.spec.js` measures actual production
pixel changes and uploaded mesh radii for 1x/40x relief, changed sea datum,
exposed seafloor and both poles. It checks deterministic restoration,
unchanged physical height readings, the cache bound and explicit failure
without a fallback when downloaded local ETOPO bytes are corrupted.

`npx playwright test earth-inspection.spec.js` clicks a projected geographic
point through the actual canvas, verifies the tilted-body coordinate result
and metre readout, ignores out-and-back camera drags, clears stale settings,
and handles texture-only, background misses and unsupported baseline mode.
