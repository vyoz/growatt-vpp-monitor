README

A Growatt VPP monitor, set up to monitor the home solar-battery system for Growatt.

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
  https://github.com/8none1/growatt_sph_nodered/
