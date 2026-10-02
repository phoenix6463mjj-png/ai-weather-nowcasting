// One plain number per public building in Shelter options (list, map pins, 3D pins): those outside every
// alert area first (1..n, filled pins), then those inside an alert area (n+1.., hollow pins).
export function numberShelters(data) {
    if (!data?.available) return { outside: [], inside: [] };
    const outside = data.candidates.map((c, i) => ({ ...c, no: i + 1 }));
    const inside = data.inside_candidates.map((c, i) => ({ ...c, no: outside.length + i + 1 }));
    return { outside, inside };
}
