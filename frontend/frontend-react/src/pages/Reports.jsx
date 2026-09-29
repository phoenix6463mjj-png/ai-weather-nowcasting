import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../config';
import HonestyBanner from '../components/HonestyBanner';
import {
    FileText,
    ArrowLeft,
    Download,
    Eye,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    ShieldCheck,
    Activity,
    Calendar,
    MapPin,
    FileSpreadsheet,
    CheckCircle2
} from 'lucide-react';
import TopHeader from '../components/TopHeader';

// Static/baseline report data for professional meteorological reporting
const INITIAL_REPORTS = [
    {
        id: "rep-01",
        title: "National Daily Meteorological Intelligence Summary",
        description: "Example synoptic briefing layout: monsoon trough, moisture transport and rule-based threshold breaches across sectors.",
        type: "PDF",
        date: "23 Sep 2026 • 06:00 IST",
        highRiskCount: 14,
        regionCoverage: "All-India (36 States & UTs)",
        riskDistribution: { high: 22, moderate: 45, low: 33 },
        insight: "Depression over west-central Bay of Bengal continues to pump intense moisture into eastern coastal corridors. Convective instability elevated in Western Ghats and Andhra Pradesh.",
        affectedCities: [
            { city: "Vizianagaram", state: "Andhra Pradesh", hazard: "Flash Flood", severity: "HIGH", metric: "38.4 mm/hr" },
            { city: "Ratnagiri", state: "Maharashtra", hazard: "Heavy Squall", severity: "HIGH", metric: "24.1 m/s wind" },
            { city: "Anantapur", state: "Andhra Pradesh", hazard: "Thunderstorm", severity: "HIGH", metric: "14.2 m/s wind" },
            { city: "Kozhikode", state: "Kerala", hazard: "Waterlogging", severity: "MODERATE", metric: "22.0 mm/hr" },
            { city: "Shimla", state: "Himachal Pradesh", hazard: "Slope Runoff", severity: "MODERATE", metric: "18.5 mm/hr" }
        ]
    },
    {
        id: "rep-02",
        title: "Nowcasting Rapid Alert & Telemetry Incident Log",
        description: "Example incident-log layout: timestamped rule-based threshold triggers.",
        type: "CSV",
        date: "23 Sep 2026 • 01:15 IST",
        highRiskCount: 8,
        regionCoverage: "100 Monitored Stations",
        riskDistribution: { high: 18, moderate: 52, low: 30 },
        insight: "Example text: 8 localized rule-based threshold triggers within a 6-hour window.",
        affectedCities: [
            { city: "Nagpur", state: "Maharashtra", hazard: "Lightning Storm", severity: "HIGH", metric: "92 kVA discharge" },
            { city: "Hyderabad", state: "Telangana", hazard: "Urban Inundation", severity: "HIGH", metric: "31.2 mm/hr" },
            { city: "Vijayawada", state: "Andhra Pradesh", hazard: "Gale Wind", severity: "HIGH", metric: "13.8 m/s" },
            { city: "Pune", state: "Maharashtra", hazard: "Intense Downpour", severity: "MODERATE", metric: "19.0 mm/hr" },
            { city: "Cuttack", state: "Odisha", hazard: "Surface Runoff", severity: "MODERATE", metric: "16.4 mm/hr" }
        ]
    },
    {
        id: "rep-03",
        title: "Severe Weather & River Basin Hydrological Advisory",
        description: "Catchment runoff calculations, reservoir storage inflows, and storm surge vulnerability assessments for major river drainage basins.",
        type: "PDF",
        date: "22 Sep 2026 • 18:00 IST",
        highRiskCount: 11,
        regionCoverage: "Peninsular & Eastern River Basins",
        riskDistribution: { high: 28, moderate: 42, low: 30 },
        insight: "Discharge rates across Godavari and Krishna delta basins approaching Warning Stage-II. Sluice gate regulations advised for 4 major downstream reservoirs.",
        affectedCities: [
            { city: "Rajahmundry", state: "Andhra Pradesh", hazard: "Basin Overflow", severity: "HIGH", metric: "Danger Mark +1.2m" },
            { city: "Surat", state: "Gujarat", hazard: "Tidal Surge", severity: "HIGH", metric: "High Tide 4.8m" },
            { city: "Patna", state: "Bihar", hazard: "Bank Erosion", severity: "HIGH", metric: "Inflow 42,000 cusecs" },
            { city: "Guwahati", state: "Assam", hazard: "Brahmaputra Crest", severity: "MODERATE", metric: "Warning +0.5m" },
            { city: "Kolhapur", state: "Maharashtra", hazard: "Panchganga Swell", severity: "MODERATE", metric: "Runoff 28 mm/hr" }
        ]
    },
    {
        id: "rep-04",
        title: "Model Evaluation Report (layout only)",
        description: "Example layout for an evaluation ledger. No evaluation is shown here; the ML model's measured skill is on ML Nowcast → Results.",
        type: "CSV",
        date: "22 Sep 2026 • 12:00 IST",
        highRiskCount: 3,
        regionCoverage: "Example regions",
        riskDistribution: { high: 8, moderate: 32, low: 60 },
        insight: "No evaluation figures are given in this example report.",
        affectedCities: [
            { city: "Bengaluru", state: "Karnataka", hazard: "Convective Cell", severity: "MODERATE", metric: "not evaluated" },
            { city: "Chennai", state: "Tamil Nadu", hazard: "Coastal Convergence", severity: "MODERATE", metric: "not evaluated" },
            { city: "Jaipur", state: "Rajasthan", hazard: "Dry Line Instability", severity: "LOW", metric: "not evaluated" },
            { city: "Delhi NCR", state: "National Capital", hazard: "Frontal Squall", severity: "LOW", metric: "not evaluated" },
            { city: "Kolkata", state: "West Bengal", hazard: "Low Pressure Drift", severity: "LOW", metric: "not evaluated" }
        ]
    }
];

const Reports = () => {
    const [reports, setReports] = useState(INITIAL_REPORTS);
    const [expandedReportId, setExpandedReportId] = useState("rep-01"); // First card expanded by default
    const [downloadingId, setDownloadingId] = useState(null);
    const [summaryStats, setSummaryStats] = useState({
        totalReportsToday: 18,
        totalAlertsLogged: 42,
        highRiskPercentage: "24.8%",
        systemStatus: "Checking…"
    });

    // Optionally sync summary stats with live alerts endpoint if reachable
    useEffect(() => {
        let isMounted = true;
        const fetchLiveAlertSummary = async () => {
            try {
                const res = await fetch(`${API_BASE}/alerts`);
                if (res.ok && isMounted) {
                    const data = await res.json();
                    const liveAlerts = data.alerts || [];
                    if (liveAlerts.length > 0) {
                        const highAlerts = liveAlerts.filter(a => String(a.severity).toUpperCase() === "HIGH").length;
                        const pct = Math.round((highAlerts / liveAlerts.length) * 100);
                        setSummaryStats({
                            totalReportsToday: 18,
                            totalAlertsLogged: liveAlerts.length,
                            highRiskPercentage: `${pct}%`,
                            systemStatus: "Backend reachable"
                        });

                        // Optionally enrich first report with live affected cities
                        setReports(prev => {
                            const updated = [...prev];
                            const liveAffected = liveAlerts.slice(0, 5).map(a => ({
                                city: a.city,
                                state: "Monitored Zone",
                                hazard: a.type || "Weather Warning",
                                severity: String(a.severity).toUpperCase() === "HIGH" ? "HIGH" : "MODERATE",
                                metric: a.message || a.type || "Rule-based alert"
                            }));
                            if (liveAffected.length > 0) {
                                updated[0] = {
                                    ...updated[0],
                                    highRiskCount: highAlerts,
                                    affectedCities: liveAffected
                                };
                            }
                            return updated;
                        });
                    }
                }
            } catch {
                if (isMounted) setSummaryStats((s) => ({ ...s, systemStatus: "Backend not reachable" }));
            }
        };

        fetchLiveAlertSummary();
        return () => {
            isMounted = false;
        };
    }, []);

    // Toggle preview panel
    const togglePreview = (id) => {
        setExpandedReportId(prev => (prev === id ? null : id));
    };

    // Functional report download (PDF or CSV)
    const handleExport = (report) => {
        setDownloadingId(report.id);

        setTimeout(() => {
            try {
                if (report.type === "CSV") {
                    // Generate structured CSV file
                    const headers = "City,State,Hazard_Type,Severity_Level,Threshold_Metric\n";
                    const rows = report.affectedCities.map(c =>
                        `"${c.city}","${c.state}","${c.hazard}","${c.severity}","${c.metric}"`
                    ).join("\n");
                    const csvContent = `data:text/csv;charset=utf-8,# ${report.title}\n# Generated: ${report.date}\n# Coverage: ${report.regionCoverage}\n\n${headers}${rows}`;
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", `${report.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } else {
                    // Generate formatted text/print summary file
                    const content = `=======================================================\n` +
                        `NATIONAL METEOROLOGICAL INTELLIGENCE REPORT\n` +
                        `=======================================================\n` +
                        `Title:    ${report.title}\n` +
                        `Date:     ${report.date}\n` +
                        `Coverage: ${report.regionCoverage}\n` +
                        `Status:   Level-1 Monitored | High Risk Count: ${report.highRiskCount}\n` +
                        `-------------------------------------------------------\n` +
                        `METEOROLOGICAL INSIGHT:\n` +
                        `${report.insight}\n\n` +
                        `TOP AFFECTED SECTORS:\n` +
                        report.affectedCities.map((c, i) => `${i + 1}. ${c.city} (${c.state}) - [${c.severity}] ${c.hazard} | ${c.metric}`).join("\n") +
                        `\n\nRISK DISTRIBUTION:\n` +
                        `- High Priority:     ${report.riskDistribution.high}%\n` +
                        `- Moderate Advisory: ${report.riskDistribution.moderate}%\n` +
                        `- Baseline Low:      ${report.riskDistribution.low}%\n` +
                        `=======================================================\n` +
                        `Example report (illustrative) - not an official bulletin`;

                    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.setAttribute("href", url);
                    link.setAttribute("download", `${report.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.txt`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }
            } finally {
                setDownloadingId(null);
            }
        }, 500);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
            <TopHeader onSearch={() => {}} searchLoading={false} selectedCity="All India" />

            <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
                <HonestyBanner kind="illustrative" />
                {/* Header */}
                <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-900/50">
                            <FileText size={26} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-slate-900 dark:text-white">
                                Meteorological Intelligence Report Center
                            </h1>
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                Example report layouts (illustrative) and the current zone-list counts
                            </p>
                        </div>
                    </div>
                    <Link
                        to="/"
                        className="self-start sm:self-center flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-colors shadow-xs"
                    >
                        <ArrowLeft size={14} />
                        <span>Back to Dashboard</span>
                    </Link>
                </div>

                {/* 1. TOP SUMMARY STRIP (4 cards in grid) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {/* Card 1: Total Reports Today */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs transition-all">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Total Reports Today
                            </span>
                            <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg">
                                <FileText size={18} />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                            {summaryStats.totalReportsToday}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            4 scheduled bulletins, 14 automated dispatches
                        </p>
                    </div>

                    {/* Card 2: Total Alerts Logged */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs transition-all">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Total Alerts Logged
                            </span>
                            <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-lg">
                                <AlertTriangle size={18} />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                            {summaryStats.totalAlertsLogged}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            From the rule-based zone list
                        </p>
                    </div>

                    {/* Card 3: High Risk Percentage */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs transition-all">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                High Risk Percentage
                            </span>
                            <div className="p-2 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-lg">
                                <Activity size={18} />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-red-600 dark:text-red-400 mt-2">
                            {summaryStats.highRiskPercentage}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Share of zones at rule-based HIGH
                        </p>
                    </div>

                    {/* Card 4: System Status */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs transition-all">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                System Status
                            </span>
                            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-lg">
                                <ShieldCheck size={18} />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1.5">
                            <CheckCircle2 size={20} />
                            <span>{summaryStats.systemStatus}</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Team backend (/alerts)
                        </p>
                    </div>
                </div>

                {/* Section Title */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                            Archival & Automated Intelligence Dossiers
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Example reports (illustrative) — not official bulletins
                        </p>
                    </div>
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {reports.length} Reports Available
                    </span>
                </div>

                {/* 2. STRUCTURED REPORT CARDS (Grid: 2 columns desktop, 1 column mobile) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {reports.map((report) => {
                        const isExpanded = expandedReportId === report.id;
                        const isDownloading = downloadingId === report.id;

                        return (
                            <div
                                key={report.id}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md transition-all flex flex-col justify-between"
                            >
                                <div>
                                    {/* Card Header: Title + Type Badge */}
                                    <div className="flex items-start justify-between gap-3 mb-2">
                                        <div>
                                            <h3 className="font-bold text-base text-slate-900 dark:text-white leading-snug">
                                                {report.title}
                                            </h3>
                                            <span data-testid="report-example-label" className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">Example report (illustrative)</span>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider shrink-0 ${
                                            report.type === 'PDF'
                                                ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-900'
                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-900'
                                        }`}>
                                            {report.type}
                                        </span>
                                    </div>

                                    {/* Short Description */}
                                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                                        {report.description}
                                    </p>

                                    {/* Metadata Section */}
                                    <div className="grid grid-cols-3 gap-2 py-3 px-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-800 text-xs mb-4">
                                        <div>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                                                <Calendar size={11} /> Date
                                            </span>
                                            <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px] truncate block mt-0.5">
                                                {report.date}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                                                <AlertTriangle size={11} /> High Risk Count
                                            </span>
                                            <span className="font-black text-red-600 dark:text-red-400 text-[11px] block mt-0.5">
                                                {report.highRiskCount} Sectors
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                                                <MapPin size={11} /> Region Coverage
                                            </span>
                                            <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px] truncate block mt-0.5">
                                                {report.regionCoverage}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* 3. EXPANDABLE PREVIEW PANEL (IMPORTANT) */}
                                {isExpanded && (
                                    <div className="mb-4 pt-3.5 border-t border-slate-200 dark:border-slate-800 space-y-3.5">
                                        {/* Short Insight Text */}
                                        <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900/40">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-400 block mb-1">
                                                Automated Executive Summary
                                            </span>
                                            <p className="text-xs text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                                                {report.insight}
                                            </p>
                                        </div>

                                        {/* Risk Distribution Breakdown */}
                                        <div>
                                            <div className="flex items-center justify-between text-xs mb-1.5 font-bold">
                                                <span className="text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider">
                                                    Risk Distribution Spectrum
                                                </span>
                                                <div className="flex items-center gap-3 text-[11px]">
                                                    <span className="text-red-600 dark:text-red-400">High: {report.riskDistribution.high}%</span>
                                                    <span className="text-amber-600 dark:text-amber-400">Mod: {report.riskDistribution.moderate}%</span>
                                                    <span className="text-emerald-600 dark:text-emerald-400">Low: {report.riskDistribution.low}%</span>
                                                </div>
                                            </div>
                                            <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800">
                                                <div
                                                    className="h-full bg-red-500"
                                                    style={{ width: `${report.riskDistribution.high}%` }}
                                                    title={`High Risk: ${report.riskDistribution.high}%`}
                                                />
                                                <div
                                                    className="h-full bg-amber-400"
                                                    style={{ width: `${report.riskDistribution.moderate}%` }}
                                                    title={`Moderate: ${report.riskDistribution.moderate}%`}
                                                />
                                                <div
                                                    className="h-full bg-emerald-500"
                                                    style={{ width: `${report.riskDistribution.low}%` }}
                                                    title={`Low: ${report.riskDistribution.low}%`}
                                                />
                                            </div>
                                        </div>

                                        {/* Top 5 Affected Cities List */}
                                        <div>
                                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-2">
                                                Top 5 Monitored Sectors:
                                            </span>
                                            <div className="space-y-1.5">
                                                {report.affectedCities.map((c, cIdx) => (
                                                    <div
                                                        key={cIdx}
                                                        className="flex items-center justify-between p-2 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <span className={`w-1.5 h-1.5 rounded-full ${
                                                                c.severity === 'HIGH' ? 'bg-red-500' : c.severity === 'MODERATE' ? 'bg-amber-400' : 'bg-emerald-500'
                                                            }`} />
                                                            <span className="font-bold text-slate-900 dark:text-slate-100">
                                                                {c.city}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400 hidden sm:inline">
                                                                ({c.state})
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                                                {c.hazard}
                                                            </span>
                                                            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600">
                                                                {c.metric}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                    {/* Secondary Button: View Preview */}
                                    <button
                                        type="button"
                                        onClick={() => togglePreview(report.id)}
                                        className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                                    >
                                        <Eye size={13} className="text-slate-500" />
                                        <span>{isExpanded ? "Hide Preview" : "View Preview"}</span>
                                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </button>

                                    {/* Primary Button: Export PDF / CSV */}
                                    <button
                                        type="button"
                                        onClick={() => handleExport(report)}
                                        disabled={isDownloading}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer shadow-xs"
                                    >
                                        {report.type === "CSV" ? (
                                            <FileSpreadsheet size={13} />
                                        ) : (
                                            <Download size={13} />
                                        )}
                                        <span>
                                            {isDownloading ? "Generating..." : `Export ${report.type}`}
                                        </span>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </main>
        </div>
    );
};

export default Reports;
