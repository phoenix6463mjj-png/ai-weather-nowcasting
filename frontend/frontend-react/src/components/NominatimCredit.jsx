// Required attribution for place-search results (OpenStreetMap data via Nominatim, ODbL), shown next
// to the searched place (nowcast_data serve/assets/credits/SOURCES.json, id "nominatim").
const NominatimCredit = ({ className = '' }) => (
    <span data-testid="nominatim-credit" className={`text-credits text-slate-500 dark:text-slate-400 ${className}`}>
        Place search: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">© OpenStreetMap contributors</a>, ODbL, via Nominatim
    </span>
);

export default NominatimCredit;
