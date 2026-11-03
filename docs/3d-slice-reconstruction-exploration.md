# Diagnostic Slice-Stack Navigator & 3D Reconstruction Exploration

Status: **Exploratory / Design RFC** — tracked in [#1744](https://github.com/bcit-tlu/hriv/issues/1744).

This document captures architectural findings, proof-of-concept observations, and design options for introducing cross-sectional diagnostic slice-stack navigation and translucent 3D anatomical reconstruction in HRIV.

---

## 1. Pedagogical Goals

Students studying cross-sectional diagnostic imaging (axial, coronal, and sagittal CT/MRI series) must bridge two cognitive gaps:

1. **2D Spatial Orientation & Structure Tracking:** Identifying _where_ a slice plane intersects the patient's body along the craniocaudal, anteroposterior, or mediolateral axis, and following anatomical structures (organs, muscles, vessels, skeletal landmarks) continuously as they step from slice to slice.
2. **2D-to-3D Mental Reconstruction:** Synthesizing flat grayscale cross-sections into a coherent 3D understanding of how organs sit relative to one another in physical space.

---

## 2. Two Complementary Teaching Workflows

### 2.1 2D Slice-Stack Navigator with Patient Locator & Color-Coordinated Pins

Inspired by clinical and anatomical teaching viewers (e.g., _abdomen - axial_ `1..86` and _thorax - coronal_ `1..53` slice stacks), this workflow pairs three synchronized components:

1. **Patient Body Reference Model (Left Panel):**
   - Displays an anatomical silhouette matched to the series orientation:
     - **Axial (`Z`):** Anterior coronal silhouette with a horizontal orange plane line moving superior-to-inferior.
     - **Coronal (`Y`):** Lateral sagittal profile with a vertical orange plane line moving anterior-to-posterior.
     - **Sagittal (`X`):** Anterior coronal silhouette with a vertical orange plane line moving left-to-right.
   - Highlights the series scan coverage as a translucent band over the body region (e.g., thorax, abdomen, pelvis) and renders an **orange slice-plane line** at the active slice's normalized position.
2. **Annotated 2D Slice Viewport (Center Panel):**
   - Renders the active diagnostic slice (`i / N`) with **color-coordinated landmark pins/markers**.
   - Each pin belongs to an anatomical group/system (e.g., _Skeletal_, _Musculature_, _GI Tract / Hepatobiliary_, _Vascular_, _Respiratory / Pleural_) and shares a consistent color across all slices in the stack.
   - A header filter (_All Groups_ / specific organ system / _None_) plus a structure selector allows students to isolate or trace specific structures as they scrub through the stack.
3. **Vertical Slice Scrubber (Right Panel):**
   - A vertical slider (`1 / N`) and mouse-wheel / arrow-key handler that steps sequentially through the slice stack while updating both the 2D viewport and the orange reference plane on the patient silhouette in real time.

### 2.2 Translucent 3D Anatomical Reconstruction & Slice Correlation

Allows students to view the slice stack as a rotatable, translucent 3D anatomical volume or surface-mesh assembly:

- **Per-Organ Visibility & Translucency:** Students can toggle individual anatomical structures (e.g., _Pelvic Bones & Sacrum_, _Iliopsoas Muscles_, _Iliac Vessels_, _Colon_, _Small Bowel Loops_, _Intraluminal Oral Contrast_, _Superficial Musculature_) and adjust their opacity independently so deeper structures are visible inside outer structures.
- **Single-Slice 3D Isolation ("Solo" Mode):**
  - Clicking a slice thumbnail (or scrubbing to a slice in single-slice inspection mode) **hides the surrounding 3D structures by default (`0%` context opacity)** and renders only that 2D diagnostic slice at its true 3D position inside a reference bounding frame.
  - A **"Surrounding 3D Context"** slider (`0%–100%`) lets students gradually fade the 3D organ meshes back in around the active 2D slice plane so they can see how the 3D organs pass directly through the 2D cross-section.

---

## 3. 3D Reconstruction Architecture: Tier 1 vs. Tier 2

Both approaches were prototyped in WebGL2 against a 5-slice axial pelvic CT set (`512 × 512` 8-bit soft-tissue windowed JPEGs).

### Tier 1: Client-Side Direct Volume Rendering (DVR / Ray Marching)

- **Mechanism:** Stacks the 2D slices into a WebGL2 `TEXTURE_3D` volume (with optional Catmull-Rom cubic interpolation along `Z`), casts viewing rays through the bounding box, and maps pixel intensity (`0–255`) to color and opacity via a multi-band transfer function plus 3D Sobel gradient lighting.
- **Outer Wall Peeling:** Because superficial abdominal wall muscle and skin share the same grayscale intensity (`~100–165`) as internal organs, an inward 2D distance transform from the body contour is required to peel back the outer perimeter and expose the peritoneal cavity.
- **Limitations Discovered in PoC:**
  - **Overlapping Soft-Tissue Intensities:** Unsegmented ray-marching treats all mid-gray pixels (`~100–170`) identically, causing psoas muscles, unopacified bowel walls, and mesenteric structures to blend into a single "blobby" cloud.
  - **High-Density Clipping (`255`):** In 8-bit soft-tissue windowed images, both cortical bone and oral/IV contrast clip to pure white (`255`), preventing a purely intensity-based transfer function from separating bone from bowel contrast.
  - **Sparse `Z` Sampling:** With only a handful of slices (e.g., 5 slices vs. 60–150 in a full clinical series), tortuous structures like small bowel loops extrude vertically rather than curving smoothly in 3D.

### Tier 2: Hybrid Slice-Driven Segmentation + Sculpted 3D Surface Meshes

- **Mechanism:**
  1. **Anatomical Segmentation:** Each slice is segmented into discrete anatomical structure masks (via AI organ segmentation such as TotalSegmentator / MONAI / MedSAM, connected-component topology, or interpolation of instructor-curated landmark contours).
  2. **Morphological Cavity Filling & Cortical Halo Absorption:**
     - In 8-bit CT slices, dense cortical bone (`>= 185`) encloses darker trabecular marrow (`100–180`) and is surrounded by a 2–4 px partial-volume gray transition rim (`82–184`).
     - If segmentation relies on a raw brightness threshold, toggling bone off leaves behind a hollow outer ring of edge pixels.
     - Running **2D connected-component flood-filling + internal marrow hole-filling + 4 px morphological dilation into the cortical halo** captures the entire anatomical bone cross-section so toggling bone removes 100% of the structure cleanly.
  3. **3D Signed Distance Field (SDF) + Surface Nets / Marching Cubes:** Each organ's 3D mask is smoothed with a separable 3D Gaussian filter and triangulated into a closed, watertight 3D polygon mesh.
  4. **Taubin (`λ / μ`) Non-Shrinking Surface Smoothing:** Applying 10–16 alternating passes of Laplacian (`+λ`) and inflating (`-μ`) vertex smoothing eliminates all voxel stair-stepping and pixelation without shrinking organ volume—producing "textbook-smooth" 3D anatomical surfaces that remain registered to the underlying 2D slices.
  5. **Dual-Pass Translucent Mesh Rendering:** Rendering back faces then front faces with Fresnel rim lighting and Phong specular highlights allows nested structures (such as bright oral contrast boluses inside translucent bowel loops) to be clearly discerned.

| Dimension                   | Tier 1: Intensity Ray-Marching (DVR)                 | Tier 2: Segmented + Taubin-Smoothed 3D Meshes                                                                  |
| :-------------------------- | :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| **Visual Fidelity**         | Voxel-cloud / "blobby" on sparse stacks              | Crisp, smooth, anti-aliased 3D anatomical surfaces                                                             |
| **Per-Organ Toggling**      | Limited to broad brightness bands; leaves edge halos | Exact per-organ visibility toggles & independent opacity sliders                                               |
| **Bone vs. Bowel Contrast** | Fused (both clip to `255` in 8-bit JPEGs)            | Cleanly separated into distinct skeletal and intraluminal meshes                                               |
| **Compute Requirements**    | 100% client-side, instant                            | Client-side for contour/heuristic stacks; backend worker if running ML segmentation (TotalSegmentator / MONAI) |

---

## 4. Input Image Format Considerations: 8-bit JPEG vs. 12/16-bit DICOM

| Attribute                               | 8-bit Windowed JPEGs / PNGs                                                                                                                                                                                                                  | 12/16-bit Clinical DICOM Series                                                                                                                                                                                                                                                                                                                                                  |
| :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dynamic Range**                       | `0–255` (baked window/level, typically soft-tissue window `W≈400, L≈40`, mapping `[-160 HU, +240 HU]`)                                                                                                                                       | Full calibrated Hounsfield Units (`-1024 HU` to `+3071 HU`)                                                                                                                                                                                                                                                                                                                      |
| **AI Organ Segmentation Compatibility** | **Compatible via inverse window mapping:** Mapping `[0, 255] → [-160 HU, +240 HU]` preserves soft-tissue organ boundaries well enough for 3D CT models (TotalSegmentator) and native 8-bit medical foundation models (MedSAM / BiomedParse). | **Native compatibility:** Highest accuracy; distinguishes cortical bone (`+800 HU`), trabecular bone (`+200 HU`), iodinated/barium contrast (`+300 HU`), soft tissue (`+40 HU`), fat (`-80 HU`), and lung parenchyma (`-700 HU`).                                                                                                                                                |
| **Spatial Metadata**                    | None in file headers; requires manual or collection-level metadata for `Z`-spacing and patient scan range `[start, end]`.                                                                                                                    | Built-in DICOM tags (`SliceThickness`, `SpacingBetweenSlices`, `PixelSpacing`, `ImagePositionPatient`, `ImageOrientationPatient`) provide physical millimeter spacing `(dx, dy, dz)` (often anisotropic, `dz > dx, dy`); applying `(dx, dy, dz)` scaling or resampling to isotropic voxels yields a true `1:1:1` physical aspect ratio and accurate patient locator coordinates. |
| **Recommended Slice Count**             | Works for 2D slice-stack navigation at any count (`5–100+`); for 3D reconstruction, **30–100+ contiguous slices** are recommended to avoid `Z`-axis undersampling.                                                                           | Clinical thin-slice series (`60–200+` slices at `1–2.5 mm` spacing) reduce `Z`-axis anisotropy and yield smooth 3D organ meshes after physical-spacing scaling or isotropic resampling.                                                                                                                                                                                          |

---

## 5. Integration Path with Existing HRIV Architecture

HRIV already has two foundational building blocks that align naturally with this feature:

1. **Sequence Collections (`collections.type = 'sequence'`, [docs/collections.md](collections.md)):**
   - Ordered slice stacks map directly onto `sequence` collections (`collection_images.sort_order` defines the slice index `1..N`).
   - **Authoring role & collection size cap:** Because students are capped at 20 images per `sequence` collection ([docs/collections.md](collections.md)), full diagnostic slice stacks (`30–100+` slices) are expected to be curated and published by **instructors or admins** (who have no per-collection image cap) and shared with students via `public` or program/group-`restricted` visibility. If student-authored multi-slice stacks are required in the future, the 20-image student sequence cap would need to be raised or exempted for slice-stack collections.
   - Collection-level spatial metadata can live in `collections.viewport_state` (or a dedicated slice-stack configuration key inside `viewport_state`):
     - `orientation`: `"axial" | "coronal" | "sagittal"`
     - `body_region`: `"head" | "thorax" | "abdomen" | "pelvis" | "full_body"`
     - `scan_range`: `[startNormalized, endNormalized]` (drives the highlighted band and orange slice line on the patient silhouette)
     - `z_scale`: float aspect ratio for 3D slab thickness
     - `structure_groups`: color-coordinated anatomical group definitions (`id`, `name`, `color`)
2. **Per-Image Metadata (`images.metadata`, [docs/image-metadata-and-versioning.md](image-metadata-and-versioning.md)):**
   - Color-coordinated structure pins on each slice can be stored as structured landmark annotations referencing a `structure_group_id` and `structure_id`, allowing both:
     - Fast 2D pin rendering and group filtering in the slice-stack navigator, and
     - Automated 3D spline/contour lofting across slices that share the same `structure_id`.
3. **Optional Background Segmentation Job ([docs/jobs.md](jobs.md)):**
   - If full Tier-2 AI organ segmentation is desired in a future iteration, an asynchronous arq worker job can run segmentation on a `sequence` collection and store the resulting compressed `.glb` / `.json` 3D organ mesh sidecar alongside the collection's assets.
