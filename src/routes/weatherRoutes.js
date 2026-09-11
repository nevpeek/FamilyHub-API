const express = require("express");
const db = require("../database/db");

const router = express.Router();

const CACHE_DURATION_MS = 15 * 60 * 1000;

const weatherCache = new Map();

function getCacheKey(latitude, longitude, timezone) {
  return `${latitude}:${longitude}:${timezone}`;
}

function getWeatherWarnings(day) {
  const warnings = [];

  if (!day) {
    return warnings;
  }

  const weatherCode = Number(day.weatherCode);

  const rainChance = Number(
    day.precipitationProbability
  );

  const temperatureMax = Number(
    day.temperatureMax
  );

  const temperatureMin = Number(
    day.temperatureMin
  );

if (
  Number.isFinite(rainChance) &&
 rainChance >= 70
) {
    warnings.push({
      type: "rain",
      severity:
        rainChance >= 90 ? "high" : "medium",
      title: "High chance of rain",
      message: `${Math.round(
        rainChance
      )}% chance of rain`,
    });
  }

  if (
    [95, 96, 99].includes(weatherCode)
  ) {
    warnings.push({
      type: "storm",
      severity: "high",
      title: "Thunderstorm forecast",
      message:
        "Thunderstorms are forecast for this day",
    });
  }

  if (
    Number.isFinite(temperatureMax) &&
    temperatureMax >= 35
  ) {
    warnings.push({
      type: "heat",
      severity:
        temperatureMax >= 40
          ? "high"
          : "medium",
      title: "Hot weather",
      message: `Forecast high of ${Math.round(
        temperatureMax
      )}°C`,
    });
  }

  if (
    Number.isFinite(temperatureMin) &&
    temperatureMin <= 2
  ) {
    warnings.push({
      type: "cold",
      severity:
        temperatureMin <= 0
          ? "high"
          : "medium",
      title: "Very cold weather",
      message: `Forecast low of ${Math.round(
        temperatureMin
      )}°C`,
    });
  }

  return warnings;
}

router.get("/settings", (req, res) => {
  try {
    const settings = db
      .prepare(`
        SELECT
          location_name,
          latitude,
          longitude,
          timezone,
          warnings_enabled
        FROM weather_settings
        WHERE id = 1
      `)
      .get();

    res.json({
      locationName:
        settings?.location_name || "Gawler, SA",
      latitude:
        settings?.latitude ?? -34.6,
      longitude:
        settings?.longitude ?? 138.75,
      timezone:
        settings?.timezone ||
        "Australia/Adelaide",
      warningsEnabled:
        Boolean(settings?.warnings_enabled),
    });
  } catch (error) {
    console.error(
      "Weather settings error:",
      error
    );

    res.status(500).json({
      error: "Unable to load weather settings",
    });
  }
});

router.put("/settings", (req, res) => {
  try {
    const {
      locationName,
      latitude,
      longitude,
      timezone,
      warningsEnabled = true,
    } = req.body;

    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);

    if (
      !locationName ||
      !String(locationName).trim()
    ) {
      return res.status(400).json({
        error: "Location name is required",
      });
    }

    if (
      !Number.isFinite(parsedLatitude) ||
      !Number.isFinite(parsedLongitude)
    ) {
      return res.status(400).json({
        error:
          "Valid latitude and longitude are required",
      });
    }

    db.prepare(`
      UPDATE weather_settings
      SET
        location_name = ?,
        latitude = ?,
        longitude = ?,
        timezone = ?,
        warnings_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      String(locationName).trim(),
      parsedLatitude,
      parsedLongitude,
      String(timezone || "Australia/Adelaide"),
      warningsEnabled ? 1 : 0
    );

    weatherCache.clear();

    const settings = db
      .prepare(`
        SELECT
          location_name,
          latitude,
          longitude,
          timezone,
          warnings_enabled
        FROM weather_settings
        WHERE id = 1
      `)
      .get();

    res.json({
      locationName: settings.location_name,
      latitude: settings.latitude,
      longitude: settings.longitude,
      timezone: settings.timezone,
      warningsEnabled:
        Boolean(settings.warnings_enabled),
    });
  } catch (error) {
    console.error(
      "Weather settings update error:",
      error
    );

    res.status(500).json({
      error: "Unable to save weather settings",
    });
  }
});

router.get("/geocode", async (req, res) => {
  const query = String(
    req.query.query || ""
  ).trim();

  if (!query) {
    return res.status(400).json({
      error: "Location is required",
    });
  }

  try {
    const params = new URLSearchParams({
      name: query,
      count: "5",
      language: "en",
      format: "json",
    });

    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(
        `Geocoding provider returned ${response.status}`
      );
    }

let data = await response.json();

if (
  !Array.isArray(data.results) ||
  data.results.length === 0
) {
  const fallbackQuery = query
    .replace(
      /\s+(SA|NSW|VIC|QLD|WA|TAS|NT|ACT)$/i,
      ""
    )
    .trim();

  if (fallbackQuery !== query) {
    const fallbackParams = new URLSearchParams({
      name: fallbackQuery,
      count: "5",
      language: "en",
      format: "json",
    });

    const fallbackResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${fallbackParams.toString()}`
    );

    if (fallbackResponse.ok) {
      data = await fallbackResponse.json();
    }
  }
}

const results = Array.isArray(data.results)
  ? data.results.map((result) => ({
      name: result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      country: result.country || null,
      state: result.admin1 || null,
      postcode: result.postcodes?.[0] || null,
      timezone: result.timezone || null,
    }))
  : [];

    res.json({
      query,
      results,
    });
  } catch (error) {
    console.error(
      "Weather geocoding error:",
      error
    );

    res.status(502).json({
      error: "Unable to find location",
    });
  }
});

router.get("/location", async (req, res) => {
  const query = String(
    req.query.query || ""
  ).trim();

  if (!query) {
    return res.status(400).json({
      error: "Location is required",
    });
  }

  try {
    let searchQuery = query;

    async function findLocation(value) {
      const params = new URLSearchParams({
        name: value,
        count: "5",
        language: "en",
        format: "json",
      });

      const response = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(
          `Geocoding provider returned ${response.status}`
        );
      }

      const data = await response.json();

      return Array.isArray(data.results)
        ? data.results
        : [];
    }

    let locations =
      await findLocation(searchQuery);

    if (locations.length === 0) {
      const fallbackQuery = query
        .replace(
          /\s+(SA|NSW|VIC|QLD|WA|TAS|NT|ACT)$/i,
          ""
        )
        .trim();

      if (fallbackQuery !== query) {
        searchQuery = fallbackQuery;
        locations =
          await findLocation(fallbackQuery);
      }
    }

    const location =
      locations.find(
        (result) =>
          result.country === "Australia" &&
          result.admin1 === "South Australia"
      ) || locations[0];

    if (!location) {
      return res.status(404).json({
        error: "Location not found",
      });
    }

    const weatherParams = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone:
        location.timezone ||
        "Australia/Adelaide",
      forecast_days: "7",
    });

    const weatherResponse = await fetch(
      `https://api.open-meteo.com/v1/forecast?${weatherParams.toString()}`
    );

    if (!weatherResponse.ok) {
      throw new Error(
        `Weather provider returned ${weatherResponse.status}`
      );
    }

    const weatherData =
      await weatherResponse.json();

const daily = Array.isArray(
  weatherData.daily?.time
)
  ? weatherData.daily.time.map(
      (date, index) => {
        const day = {
          date,
          weatherCode:
            weatherData.daily.weather_code?.[
              index
            ] ?? null,
          temperatureMax:
            weatherData.daily
              .temperature_2m_max?.[
                index
              ] ?? null,
          temperatureMin:
            weatherData.daily
              .temperature_2m_min?.[
                index
              ] ?? null,
          precipitationProbability:
            weatherData.daily
              .precipitation_probability_max?.[
                index
              ] ?? null,
        };

        return {
          ...day,
          warnings:
            getWeatherWarnings(day),
        };
      }
    )
  : [];

    res.json({
      query,
      location: {
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        state: location.admin1 || null,
        country: location.country || null,
        timezone:
          location.timezone ||
          "Australia/Adelaide",
      },
      daily,
    });
  } catch (error) {
    console.error(
      "Location weather error:",
      error
    );

    res.status(502).json({
      error:
        "Unable to load weather for location",
    });
  }
});

router.get("/", async (req, res) => {
  const savedSettings = db
    .prepare(`
      SELECT
        location_name,
        latitude,
        longitude,
        timezone,
        warnings_enabled
      FROM weather_settings
      WHERE id = 1
    `)
    .get();

  const latitude = Number(
    req.query.latitude ??
      savedSettings?.latitude ??
      -34.6
  );

  const longitude = Number(
    req.query.longitude ??
      savedSettings?.longitude ??
      138.75
  );

  const timezone =
    req.query.timezone ||
    savedSettings?.timezone ||
    "Australia/Adelaide";

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return res.status(400).json({
      error: "Invalid latitude or longitude",
    });
  }

  const cacheKey = getCacheKey(
    latitude,
    longitude,
    timezone
  );

  const cached = weatherCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.timestamp <
      CACHE_DURATION_MS
  ) {
    return res.json({
      ...cached.data,
      cached: true,
    });
  }

  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current:
        "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,showers,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m",
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
      timezone,
      forecast_days: "7",
    });

    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(
        `Weather provider returned ${response.status}`
      );
    }

    const data = await response.json();

    const weather = {
      location: {
        latitude,
        longitude,
        timezone,
      },
      current: {
        temperature:
          data.current?.temperature_2m ?? null,
        apparentTemperature:
          data.current?.apparent_temperature ?? null,
        humidity:
          data.current?.relative_humidity_2m ?? null,
        precipitation:
          data.current?.precipitation ?? null,
        rain:
          data.current?.rain ?? null,
        showers:
          data.current?.showers ?? null,
        weatherCode:
          data.current?.weather_code ?? null,
        cloudCover:
          data.current?.cloud_cover ?? null,
        windSpeed:
          data.current?.wind_speed_10m ?? null,
        windGusts:
          data.current?.wind_gusts_10m ?? null,
      },
daily: Array.isArray(data.daily?.time)
  ? data.daily.time.map((date, index) => {
      const day = {
        date,
        weatherCode:
          data.daily.weather_code?.[index] ??
          null,
        temperatureMax:
          data.daily.temperature_2m_max?.[
            index
          ] ?? null,
        temperatureMin:
          data.daily.temperature_2m_min?.[
            index
          ] ?? null,
        precipitationProbability:
          data.daily
            .precipitation_probability_max?.[
              index
            ] ?? null,
        sunrise:
          data.daily.sunrise?.[index] ?? null,
        sunset:
          data.daily.sunset?.[index] ?? null,
      };

return {
  ...day,
  warnings:
    savedSettings?.warnings_enabled === 0
      ? []
      : getWeatherWarnings(day),
};
    })
  : [],
      fetchedAt: new Date().toISOString(),
    };

    weatherCache.set(cacheKey, {
      timestamp: Date.now(),
      data: weather,
    });

    res.json({
      ...weather,
      cached: false,
    });
  } catch (error) {
    console.error("Weather API error:", error);

    if (cached?.data) {
      return res.json({
        ...cached.data,
        cached: true,
        stale: true,
      });
    }

    res.status(502).json({
      error: "Unable to load weather",
    });
  }
});

module.exports = router;