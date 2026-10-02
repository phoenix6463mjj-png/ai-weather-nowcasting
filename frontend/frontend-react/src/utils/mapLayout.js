// Overlays anchored at the bottom of a map (legend, layers panel) stay above the attribution control, which
// can wrap to several lines (it carries the full Copernicus DEM notice). AlertMap publishes the control's
// height as --attr-h on the map's parent.
export const ABOVE_ATTRIBUTION = { bottom: 'calc(var(--attr-h, 22px) + 4px)' };
