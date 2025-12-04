README

A Growatt VPP monitor, set up to monitor the home solar-battery system for Growatt.

## Running with Docker

This project is fully containerized and can be run easily using Docker Compose.

### Prerequisites
- Docker
- Docker Compose

### Setup & Run
1. **Configuration**: Copy `config.json.sample` to `config.json` and update the `ip` address of your inverter in the file.
   ```bash
   cp config.json.sample config.json
   ```
   Then, edit `config.json`.

2. **Start the application**:
   ```bash
   docker-compose up --build -d
   ```

3. **Access the dashboard**:
   Open your browser and navigate to [http://localhost:8080](http://localhost:8080).

4. **To stop the application**:
    ```bash
    docker-compose down
    ```

---

Inverter Model: SPH 3000-6000 TL-HUB (6000KW for my setup)
Battery: ALP 5.0L-E1 (50kwh for my setup)
Solar pannel: 6.6 KW

Python version: 3.10

Setup:
```
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Configuration:
  - Please copy config.json.sample to config.json and update the IP address of your inverter in the configuration file.
  - The log options: log, mqtt, both 

Run reader:
```
python3 src/growatt_reader.py
```

Run monitor (loop mode):
```
python3 src/growatt_monitor.py
```

Reference:
  - https://github.com/8none1/growatt_sph_nodered/
  - https://github.com/JasperE84/Growatt_ESPHome_ESP32_Modbus_RS485_Example
