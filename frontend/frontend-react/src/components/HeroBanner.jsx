import React from 'react';
const HeroBanner = ({ cityData, sample = true }) => {
    // Generate date string like "Mon, 28 Sept 2026"
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // from the selected zone only (no fixed city / temperature / sky); omitted when there is none
    const temp = cityData?.weather?.temperature != null ? Math.round(cityData.weather.temperature) : null;
    const city = cityData?.city || null;

    return (
        <div className="h-40 w-full relative shrink-0">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2000&q=80')] bg-cover bg-center"></div>
            {/* Gradient overlay to make text pop and match theme seamlessly */}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-50/95 via-blue-50/80 to-transparent dark:from-slate-900/95 dark:via-slate-900/80 dark:to-transparent"></div>

            {/* the image URL does not identify the photographer, so the generic Unsplash credit */}
            <a data-testid="photo-credit" href="https://unsplash.com/license" target="_blank" rel="noreferrer" className="absolute bottom-1 right-2 z-20 px-1.5 py-px rounded bg-black/45 text-[9px] font-semibold text-white hover:bg-black/70">Photo: Unsplash</a>
            <div className="relative z-10 h-full flex items-center justify-between px-10">
                <div>
                    <h2 data-testid="hero-title" className="text-4xl font-black text-slate-800 dark:text-white leading-tight tracking-tight">Weather Nowcasting<br/>for India</h2>
                    <p data-testid="hero-subtitle" className="text-slate-600 dark:text-slate-300 font-bold mt-2 text-sm">{sample ? 'Sample data: risk indicators are not shown.' : 'Rule-based indicators from current weather.'}</p>
                </div>

                <div className="flex items-center gap-6">

                    <div className="bg-slate-900/70 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-4 text-white flex items-center gap-6 border border-white/10 shadow-lg">
                        <div>
                            <p className="text-[11px] font-bold text-slate-300">{dateStr}</p>
                            <h3 className="text-3xl font-black tabular-nums tracking-tight my-0.5">{timeStr}</h3>
                            {city && <p className="text-[11px] font-bold text-slate-300">{city}, India</p>}
                        </div>
                        {temp != null && (
                            <div data-testid="hero-temp" className="flex flex-col items-center justify-center border-l border-white/20 pl-6">
                                <span className="text-2xl font-black">{temp}°C</span>
                                <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wide mt-0.5">{sample ? 'sample data' : cityData?.weather?.source === 'open-meteo' ? 'Open-Meteo (model data)' : 'OpenWeather'}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HeroBanner;
