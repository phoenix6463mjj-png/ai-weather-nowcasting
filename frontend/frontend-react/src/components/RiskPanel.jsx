const RiskPanel = ({ cityData }) => {
    if (!cityData || !cityData.weather) {
        return (
            <div className="h-full w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-6 flex flex-col items-center justify-center transition-colors duration-300">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"></path></svg>
                </div>
                <p className="text-slate-500 font-medium">Search or select a city to view details</p>
            </div>
        );
    }

    const { city, weather, prediction, alerts } = cityData;

    let primaryThreat = "None";
    let maxProb = 0;
    if (prediction) {
        Object.entries(prediction).forEach(([event, prob]) => {
            if (prob > maxProb) {
                maxProb = prob;
                primaryThreat = event.charAt(0).toUpperCase() + event.slice(1);
            }
        });
    }

    const getProgressBar = (prob, alertText) => {
        const percent = Math.round((prob || 0) * 100);
        let colorClass = "bg-green-500";
        if (alertText?.includes("HIGH")) colorClass = "bg-red-500";
        else if (alertText?.includes("MODERATE")) colorClass = "bg-orange-500";
        
        return (
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mt-2 overflow-hidden shadow-inner">
                <div className={`h-full ${colorClass} transition-all duration-1000 ease-out`} style={{ width: `${percent}%` }}></div>
            </div>
        );
    };

    return (
        <div className="h-full w-full bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-6 overflow-y-auto transition-colors duration-300">
            <div>
                <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">{city}</h2>
                <div className="flex items-center gap-2 mt-2">
                    <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold uppercase rounded-full tracking-wide border border-blue-200 dark:border-blue-800">
                        Primary Threat: {primaryThreat}
                    </span>
                </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700/50 dark:to-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Temperature</p>
                    <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">{weather.temperature}°C</p>
                </div>
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700/50 dark:to-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Rainfall</p>
                    <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">{weather.rainfall} mm</p>
                </div>
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700/50 dark:to-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Humidity</p>
                    <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">{weather.humidity}%</p>
                </div>
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700/50 dark:to-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Wind</p>
                    <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">{weather.wind_speed} m/s</p>
                </div>
            </div>

            {alerts && prediction && (
                <div className="mt-2 flex-1">
                    <h3 className="text-xs font-bold mb-5 text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700 pb-2">Prediction Analysis</h3>
                    
                    <div className="space-y-6">
                        {Object.keys(alerts).map(key => (
                            <div key={key}>
                                <div className="flex justify-between items-end mb-1.5">
                                    <span className="font-semibold text-slate-700 dark:text-slate-200 capitalize">{key} Risk</span>
                                    <div className="text-right flex items-center">
                                        <span className={`text-xs font-black uppercase tracking-wider mr-2 ${alerts[key]?.includes('HIGH') ? 'text-red-500' : (alerts[key]?.includes('MODERATE') ? 'text-orange-500' : 'text-green-500')}`}>
                                            {alerts[key]?.replace(" RISK", "")}
                                        </span>
                                        <span className="text-sm font-bold text-slate-600 dark:text-slate-300 w-8 text-right">{Math.round((prediction[key] || 0) * 100)}%</span>
                                    </div>
                                </div>
                                {getProgressBar(prediction[key], alerts[key])}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RiskPanel;
