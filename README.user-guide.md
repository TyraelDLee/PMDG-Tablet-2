# PMDG Tablet 2 - A data driven EFB streamed over LAN

PMDG Tablet 2 extends PMDG's tablet in MSFS 2024 with GSX Pro, BeyondATC, IniJetway, Landing Analysis, and Dispatch for SimBrief flight planning. It also provides a lightweight service that lets you view and control the EFB from another device on the same LAN, such as an iPad.

The LAN connection uses a data-driven approach: it sends page content, state, and user input instead of a video stream. Your simulator remains responsible for the aircraft functions, while the client provides mouse and touchscreen control.


## Supported aircraft
- 737-600
- 737-700 all variants
- 737-800 all variants
- 737-900 all variants
- 777-200ER
- 777-300ER
- 777-200LR/F


## Supported features

### In sim
- Everything from the original tablet.
- GSX Pro integration (GSX Pro needed)
- BATC toolbar integration (BATC needed)
- Landing analysis
- IniJetway multi-jetway control at compatible airports.
- Dispatch for SimBrief flight planning, with optional Real-world flight selection.

### On LAN device
- PMDG maps
- Navigraph charts (Navigraph account setup in EFB needed)
- Everything in performance calculation 
- Everything in ground operations
- Everything in Weight & Balance
- GSX Pro integration (GSX Pro needed)
- BATC toolbar integration (BATC needed)
- Landing analysis

The LAN device controls the selected EFB in the simulator. It is not a separate, offline copy of the aircraft systems. Navigraph charts use the existing login in the simulator's EFB.

### Dispatch (SimBrief)
- Based on the official SimBrief EFB app.

#### AirLabs flight selection
Enter an optional AirLabs API key in the installer to use real route data.

- **Destination Pick:** enter an airline and departure airport, then select Pick to fill a random destination and its flight number. The flight number is numeric only; the airline stays in its own field.
- **Prefer installed airport:** enabled by default. Queries routes to airports found in your local scenery list first. If no matching route is returned, it falls back to an unrestricted destination query. Turn it off to query without an installed-airport preference.
- **Flight number Pick:** looks for a flight number matching the airline, departure, and destination. If no matching number is returned, or no API key is configured, it generates a random number. It does not change the destination.

Both destination and flight number remain manually editable. If an airframe is already selected, changing the destination can start route and alternate planning automatically. AirLabs results are cached to reduce repeated requests. Aircraft type is not used to filter AirLabs routes.

AirLabs is optional. SimBrief planning and the random flight-number fallback work without it; real destination selection requires an API key. API errors are shown in the app instead of being treated as a confirmed absence of routes.

### IniJetway

Control compatible iniBuilds multi-jetways from the PMDG tablet. The app shows the current airport and nearest identified gate, and lets you assign available jetways to supported aircraft doors.

The airport must include compatible multi-jetway support. This feature does not add multi-jetways to airports which do not provide them.

### Landing Analysis

Records touchdown G, vertical speed, pitch, indicated and ground speed, wind, sideslip, and bounces. The page shows the current landing alongside details of a selected previous landing.

## Installation
Simply run the installer. MSFS location will be automatically detected. The default port number is 8385, and it is configurable.

After installation, you will get your host's LAN IP address, the port number, and a pairing code.

### On the client device
- Open the browser, navigate to your host by using LAN IP plus port number
- For the first time setup, you need type the pairing code.


## Performance
There will be a lightweight host (~60 MB of RAM) on your host machine; it will start and shut down automatically with the sim.

## Limitation
- Navi map is not supported yet.
- May support MSFS2020, but not been tested and extra configuration will be needed.