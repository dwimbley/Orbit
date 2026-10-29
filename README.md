# Orbit

**A radial "Open with" menu for Windows.**

Drag a file out of Explorer, and a wheel appears around your cursor with apps that can open it. Drop on a wedge.

![Orbit in action](screenshots/orbit_example.gif)


## Install

Download the installer from the [Releases](../../releases) page. Per-user, no admin required.

## Build from source

```bash
git clone https://github.com/dwimbley/Orbit.git
cd Orbit
npm install
npm run rebuild-native   # builds the C++ addon
npm run build            # compiles TypeScript
npm start                # launches the app
```

**Requirements:**
- Node.js 22+
- Visual Studio 2022 (or Build Tools) with the C++ desktop development workload
- Windows 10/11 x64

### Package an installer

```bash
npm run package
# Output: release/Orbit Setup 0.1.0.exe
```

## License

[MIT](LICENSE)
