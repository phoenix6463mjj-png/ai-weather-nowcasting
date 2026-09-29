// Required Open-Meteo credit (CC BY 4.0), shown next to any place its data appear
// (backend/assets/open_meteo_terms.json).
const OpenMeteoCredit = ({ className = '' }) => (
    <span data-testid="open-meteo-credit" className={`text-[10px] text-slate-500 dark:text-slate-400 ${className}`}>
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Weather data by Open-Meteo.com</a>
        {' '}(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">CC BY 4.0</a>;
        model data, used as input to rule-based indicators)
    </span>
);

export default OpenMeteoCredit;
