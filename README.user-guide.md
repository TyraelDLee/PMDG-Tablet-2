# PMDG Tablet 2

Extend your PMDG EFB in **Microsoft Flight Simulator 2024** with GSX Pro, BeyondATC, IniJetway, Landing Analysis, and Dispatch. Use the tablet in the cockpit, or view and control it from an iPad or another browser on your local network.

LAN access sends EFB page state and user input rather than a video stream. Aircraft functions continue to run in the simulator, so your remote device controls the selected cockpit tablet.

## Supported aircraft

| Family | Models |
| --- | --- |
| PMDG 737 | 737-600, 737-700, 737-800, and 737-900, including 737-900ER and the supplied variants |
| PMDG 777 | 777-200ER, 777-200LR, 777-300ER, and 777F |

The installer supports **MSFS 2024 only**.

## What you can do

- Use PMDG's existing EFB apps, including performance calculations, Ground Operations, and Weight & Balance.
- Operate GSX Pro and BeyondATC from the tablet.
- Control compatible iniBuilds multi-jetways with IniJetway.
- Review touchdown measurements and previous landings in Landing Analysis.
- Create SimBrief flight plans in Dispatch, with optional real-world route selection through AirLabs.
- Access the EFB over LAN with mouse or touch controls, and switch between the captain's and first officer's tablets.
- View PMDG maps and Navigraph charts remotely. **Navigraph maps are currently available only inside the simulator.**

### Requirements

Install MSFS 2024 and a supported PMDG aircraft on the simulator PC. Additional features have these requirements:

| Feature | What you need |
| --- | --- |
| GSX | GSX Pro installed and running on the simulator PC |
| BeyondATC | BeyondATC installed and running on the simulator PC |
| IniJetway | An airport with compatible iniBuilds multi-jetway support; the official IniJetway EFB app is not required |
| Dispatch | A SimBrief account and the official SimBrief EFB app installed and signed in |
| Real-world destination selection | An optional AirLabs API key |
| Navigraph charts | The required Navigraph account/subscription, signed in through the simulator's PMDG EFB |
| LAN access | A browser on the same local network as the simulator PC |

These products, accounts, and subscriptions are provided separately. You can use the other tablet features without configuring every integration.

## Install and connect

### 1. Install on the simulator PC

1. Close MSFS 2024 and extract the **complete release ZIP**.
2. Run **EfbV2Setup.exe** from the extracted folder.
3. Check the detected **Community folder**. If necessary, use **Browse** to select the folder used by your MSFS 2024 installation.
4. Check the **MSFS config folder**. This is the folder containing `UserCfg.opt`, used to configure automatic startup.
5. Keep the default **LAN port, 8385**, or choose an available port if another application uses it.
6. Optionally enter an **AirLabs API key**.
7. Select **Install / Update**.

Setup installs the EFB package and LAN service. It runs as your Windows user; the selected folders must be writable. Keep the extracted bundle together when installing or updating.

The installer supports English and Simplified Chinese. It follows your Windows display language by default, and you can change it using the language selector.

### 2. Start the simulator

Launch MSFS 2024, load a supported PMDG aircraft, and turn on its EFB. The LAN service starts automatically with the simulator and exits when the simulator closes. It does not start immediately after installation.

Start GSX Pro or BeyondATC if you intend to use them. For Dispatch, open the official SimBrief EFB app and sign in before opening Dispatch in the PMDG tablet.

### 3. Connect another device

The installer's **Log** tab shows the available LAN addresses and your **four-digit pairing code**. Reopen Setup to find these details later.

1. Connect your iPad or other device to the same local network as the simulator PC.
2. Open the displayed address in its browser, for example `http://192.168.1.20:8385`.
3. Enter the pairing code when prompted.
4. Select **CA** or **FO** in the EFB top bar to choose the captain's or first officer's tablet.

On iPad, you can add the page to the Home Screen. Keep the simulator, aircraft, and EFB running while using the remote display. Use **Re-sync** in the tablet's top bar if the displayed page needs refreshing.

## Using the apps

### Dispatch

Dispatch lets you plan a flight from the PMDG tablet using your SimBrief account.

1. Sign in through the **official SimBrief EFB app**. Dispatch shares that app's login; it does not provide an independent sign-in.
2. Open **Dispatch** in the PMDG tablet.
3. Enter your departure and destination using four-letter ICAO codes, such as `VHHH` and `RJAA`.
4. Select one of your saved **Airframes**. An airframe is required before you can generate a flight plan.
5. Once both airports and the airframe are set, Dispatch looks up a route, suggested routes, and an alternate. Review these and adjust the flight details as needed.
6. Select **Generate Flight Plan** and review the resulting briefing.

Use the departure-time calendar to choose a date and time, or **Now** to use the current **simulator UTC**. Dispatch also includes flight history, saved flights, fleet management, WX, and SimBrief performance tools. SimBrief's performance tools are separate from PMDG's aircraft Performance Tool.

The first opening in a new tablet session starts a new flight form. When an airport can be identified while the aircraft is on the ground, Dispatch fills the departure automatically. Returning during the same session keeps your working form.

#### Importing the plan into PMDG

Set your **SimBrief alias in PMDG EFB Preferences**. After successfully generating a plan, Dispatch requests an import through PMDG's existing SimBrief data function.

Continue with PMDG's normal aircraft transfer workflow where required. Requesting the import does not by itself confirm that all aircraft transfers have finished.

#### Picking a flight with AirLabs

Enter your AirLabs API key in Setup to enable real-world destination selection. Use **ICAO airline codes**, such as `CPA`, rather than two-letter IATA codes.

| Control | How to use it |
| --- | --- |
| **Destination Pick** | Enter an airline and departure airport. Pick fills a random destination and its flight number, replacing an existing flight number if present. |
| **Prefer installed airport** | Enabled by default. Searches routes to your selected installed airports first, then searches without that preference if no route is returned. Turn it off to skip the preference. |
| **Flight number Pick** | Searches for a flight number matching the airline, departure, and destination. If none is returned, or no API key is configured, it generates a random number. The destination stays unchanged. |
| **Swap** | Exchanges the departure and destination. |

The airline stays in its own field; the flight-number field contains only the numeric part. Both airport and flight-number fields remain manually editable. Selecting a destination can start route and alternate planning when an airframe is already selected.

AirLabs is optional. Without a key, you can enter a destination manually and use the random flight-number fallback. Route selection depends on AirLabs coverage and your account's returned results; it does not filter by aircraft type or represent live flight availability.

### GSX and BeyondATC

Open **GSX** or **BeyondATC** from the tablet home screen to use their controls. Run the corresponding software on the simulator PC. The apps connect to those products' services; a LAN client uses the same simulator-side integration.

### IniJetway

At a compatible airport, open **IniJetway** to view the current airport and identified gate, assign available jetways to supported aircraft doors, and operate them.

Support comes from the airport's multi-jetway module. Installing this tablet app does not add multi-jetways to other airports.

### Landing Analysis

Landing Analysis records touchdown **G**, vertical speed, pitch, indicated and ground speed, wind, sideslip, and bounces. New records use **simulator Zulu time**.

The upper-left panel shows the current landing. Select an entry in the history list on the right to display its details in the lower-left panel. Before a landing or history selection is available, the corresponding values show `--`.

### Maps and charts on LAN

Use **PMDG maps** for a remote map display. Navigraph charts use the existing login in the simulator's EFB. Navigraph maps are not supported on the LAN display; selecting that map source shows **Navi Map INOP**. Navigraph maps inside the simulator are unaffected.

## Manage your installed airports

Open Setup's **Installed airports** tab to choose which airports Dispatch should prefer when **Prefer installed airport** is enabled.

- Each row shows a checkbox, ICAO code, airport name, and developer.
- Airports are selected by default. Clear a checkbox to exclude an airport from Dispatch's preferred destinations.
- Changes save automatically. They do **not** enable, disable, or uninstall scenery in MSFS.
- Select **Refresh** after adding or removing scenery. Existing exclusions are retained; newly discovered airports are selected by default.

Setup checks Community and associated MSFS 2024 package locations, including Community2024, Official2020, Official2024, and StreamedPackages. Detection depends on the available package information, so review the list and exclude entries you do not want to use. A detected entry does not guarantee that the scenery is currently enabled.

Your list is saved locally in `%LOCALAPPDATA%\EfbV2Bridge\installed-airports.json`. Setup loads the saved list when reopened, or creates one if none exists. Scanning runs during installation/update or a manual refresh, rather than continuously while flying.

## Update, configure, or uninstall

- **Update:** close MSFS, extract the new complete release, and run its **EfbV2Setup.exe**. Select **Install / Update**. Existing port, pairing code, AirLabs key, and airport selections are retained during a normal update.
- **Change the port:** close MSFS, reopen Setup, enter the new LAN port, and select **Apply port**. Use the new address when reconnecting after restarting the simulator.
- **Change the AirLabs key:** enter the new key in Setup from a complete release bundle and select **Install / Update**.
- **Uninstall:** close MSFS and select **Uninstall** in Setup. This removes this project's EFB package, LAN service, and automatic startup entry. Local configuration is retained.

Updates replace this project's `pmdg-tablet-v2` package without modifying PMDG's aircraft packages.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Community folder is not detected | Use Browse to select the folder used by your MSFS 2024 installation. |
| Setup cannot find `UserCfg.opt` | Select the MSFS configuration folder containing that file. If you have not run MSFS 2024 yet, start it once first. |
| The remote page does not connect | Start MSFS and load the aircraft/EFB. Check the PC's current LAN address, port, Windows Firewall access, and that both devices are on the same network. |
| The remote page is waiting for an aircraft | Load a supported PMDG aircraft and turn on its EFB. |
| The remote display appears out of sync | Use Re-sync in the tablet's top bar. |
| Dispatch asks for login or cannot load account data | Open the official SimBrief EFB app, sign in or refresh its login, then reconnect Dispatch. A PMDG SimBrief alias alone does not provide this login. |
| A generated plan is not imported into PMDG | Check the SimBrief alias in PMDG EFB Preferences and the status of PMDG's normal data import/transfer workflow. |
| IniJetway has no available controls | Confirm the current airport includes compatible multi-jetway support. |
| Navigraph maps do not appear on the remote device | Use PMDG maps. Navigraph maps are currently supported only inside the simulator. |

## Current limitations

- The LAN display requires the simulator and selected EFB to be running; it is not an independent flight-planning or aircraft-system instance.
- Navigraph maps are unavailable on LAN, although Navigraph charts are supported through the simulator's EFB login.
- Dispatch requires the official SimBrief EFB app's shared login. Its route preview is simplified and does not reproduce every feature of the SimBrief website.
- AirLabs destination selection uses returned route data and does not automatically retrieve every page of results.

