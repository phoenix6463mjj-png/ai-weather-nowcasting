import axios from 'axios';
import { API_BASE } from '../config';

const API_BASE_URL = API_BASE;

export const fetchPrediction = async (city) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/predict`, { city });
        return response.data;
    } catch (error) {
        if (error.response?.data?.detail) {
            throw new Error(error.response.data.detail);
        }
        if (error.code === 'ECONNABORTED' || error.message?.includes('Network Error')) {
            throw new Error(`Unable to connect to backend server at ${API_BASE_URL}. Please ensure it is running.`);
        }
        throw new Error(error.message || "Failed to fetch prediction");
    }
};

export const fetchAllPredictions = async (limit = 150) => {
    try {
        const response = await axios.get(`${API_BASE_URL}/batch_predict?limit=${limit}`);
        return response.data;
    } catch (error) {
        if (error.response?.data?.detail) {
            throw new Error(error.response.data.detail);
        }
        if (error.code === 'ECONNABORTED' || error.message?.includes('Network Error')) {
            throw new Error(`Unable to connect to backend server at ${API_BASE_URL}. Please ensure it is running.`);
        }
        throw new Error(error.message || "Failed to fetch all predictions");
    }
};

export const loadIndiaLocationsCSV = async () => {
    const response = await fetch('/india_locations.csv');
    if (!response.ok) {
        throw new Error("Failed to load india_locations.csv");
    }
    const text = await response.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const items = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = line.split(',').map(v => v.trim());
        const item = {};
        headers.forEach((h, idx) => {
            item[h] = values[idx];
        });
        items.push(item);
    }

    return items.map((item, index) => ({
        id: index,
        city: item.city,
        fullName: item.city,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        risk: (item.risk || "LOW").toUpperCase(),
        weather: null,
        prediction: null,
        isDataset: true
    })).filter(item => !isNaN(item.lat) && !isNaN(item.lon));
};

