# Bugfix Requirements Document

## Introduction

The "Calibration Dataset (Optional)" input field in `InputHuggingFaceSourceForm.tsx` is vertically misaligned with the adjacent "Task Type" select field. Both fields share a two-column CSS grid row, but the left column is taller (it includes a description paragraph below the select), causing the right column's content to stretch and misalign rather than staying top-aligned.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the InputHuggingFaceSourceForm grid row contains two columns of different heights (Task Type with description vs Calibration Dataset without description) THEN the system stretches the right column's content to fill the full row height, causing the input field to be vertically misaligned with the select field in the left column

1.2 WHEN the viewport is at `md` or wider (two-column layout active) THEN the system renders the Calibration Dataset label and input vertically centered or stretched within the grid cell instead of top-aligned

### Expected Behavior (Correct)

2.1 WHEN the InputHuggingFaceSourceForm grid row contains two columns of different heights THEN the system SHALL keep the right column's content (label + input) aligned to the top of the grid cell so it starts at the same vertical position as the left column's content

2.2 WHEN the viewport is at `md` or wider (two-column layout active) THEN the system SHALL render the Calibration Dataset label at the same vertical position as the Task Type label, and the input at the same vertical position as the select

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the viewport is narrower than `md` (single-column layout) THEN the system SHALL CONTINUE TO stack Task Type and Calibration Dataset fields vertically with normal spacing

3.2 WHEN the Task Type field is interacted with (selected, changed) THEN the system SHALL CONTINUE TO update the pipeline store state correctly

3.3 WHEN the Calibration Dataset input is typed into THEN the system SHALL CONTINUE TO update the `hfDataset` state correctly

3.4 WHEN the left column's description paragraph is present THEN the system SHALL CONTINUE TO display it below the Task Type select with its existing styling
