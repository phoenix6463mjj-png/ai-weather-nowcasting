// Required OpenWeather attribution (ODbL), shown on the screen where its data appear
// (backend/assets/openweather_terms.json: "Weather data © OpenWeather").
const OpenWeatherCredit = ({ className = '' }) => (
    <span data-testid="openweather-credit" className={`text-credits text-slate-500 dark:text-slate-400 ${className}`}>
        <a href="https://openweathermap.org/" target="_blank" rel="noreferrer" className="underline">Weather data © OpenWeather</a>
        {' '}(<a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noreferrer" className="underline">ODbL</a>;
        primary current-weather source, used as input to rule-based indicators)
    </span>
);

export default OpenWeatherCredit;
