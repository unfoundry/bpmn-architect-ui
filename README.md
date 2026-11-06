# BPMN Architect UI

> Client-side collaborative BPMN 2.0 process modeling platform with zero-backend static hosting capability, Bootswatch Lumen theme, and high-availability offline resilience.

Part of the **BPMN Architect Suite**:
- **[bpmn-architect-ui](https://github.com/unfoundry/bpmn-architect-ui)**: Client web application, process modeler, and embeddable viewer.
- **[bpmn-architect-service](https://github.com/unfoundry/bpmn-architect-service)**: Headless Python FastAPI microservice (soft-locks, dual-save persistence, Kroki SVG renderer, and administrative governance).
- **[bpmn-architect-docs](https://github.com/unfoundry/bpmn-architect-docs)**: Comprehensive VitePress documentation and deployment guides.

---

## Key Highlights

- **Zero-Backend Static Hosting**: Pure client-side HTML5, CSS3, and modern ES6 JavaScript. Can be hosted directly on static web servers (IIS, Nginx, Apache, GitHub Pages, or AWS S3) without requiring any server-side execution runtime.
- **Dedicated Route Hierarchy**:
  - `/`: **Process Library** with search, process cards, template creator, and offline fallback banner.
  - `/view/`: **Dedicated Process Viewer** with auto-fit, zoom, download, and collaboration presence. Opens by default to prevent accidental lock acquisition.
  - `/edit/`: **Interactive BPMN 2.0 Modeler** with native palette, custom quick tools (Comment annotations, User tasks, Gateway forks), and live dirty-state indicators.
  - `/embed/`: **Embeddable Viewer** with floating controls, auto-fit, and direct SVG export links for wikis, Confluence, and Jira.
- **High-Availability Offline Resilience**:
  - Automatically caches visited diagram card manifests in browser `localStorage`.
  - Supports static diagram loading via `dataStaticServeUrl` (`/diagram_storage`) directly from disk even if the editing microservice is unreachable.
  - Graceful, non-distracting offline indicators without intrusive modal popups.
- **100% Local Vendor Assets**: Completely decoupled from external CDNs. Includes local Bootswatch Lumen, Bootstrap Icons, SweetAlert2, and bpmn-js modules.
- **Resolved UMD Namespace Safety**: Uses dedicated wrappers to isolate `bpmn-modeler` on `/edit/` and lightweight `bpmn-navigated-viewer` on `/view/` and `/embed/`, ensuring tools and palettes drag smoothly without global conflicts.

---

## Directory Structure

```
bpmn-architect-ui/
├── assets/
│   ├── css/
│   │   └── app.css               # Application stylesheet with fixed 320px sidebar & Lumen styles
│   ├── js/
│   │   ├── common.js             # Bootstrap, config loading, URL .html cleaner & timeAgo helper
│   │   ├── api-client.js         # API integration with HA dataStaticServeUrl fallback
│   │   ├── viewer.js             # BPMN Navigated Viewer wrapper
│   │   └── editor.js             # BPMN Modeler wrapper with dirty-state & custom tools
│   ├── img/
│   │   ├── bpmn-architect.svg     # Top ribbon primary brand logo
│   │   └── bpmn-architect-logo.svg# Mini square badge & favicon
│   ├── sample-data/
│   │   └── user-info.json        # Mock user identity source for intranet SSO simulation
│   └── vendor/                   # 100% offline local vendor libraries (Bootswatch, bpmn-js, SweetAlert2)
├── templates/
│   ├── templates.json            # Template registry catalog
│   └── samples/                  # Pre-packaged BPMN 2.0 XML starter templates
├── view/
│   └── index.html                # Dedicated process viewer page
├── edit/
│   └── index.html                # Interactive process editor page
├── embed/
│   └── index.html                # Embeddable interactive viewer
├── index.html                    # Main process catalog & library
├── config.json                   # Central client configuration file
├── .gitignore
└── LICENSE                       # Apache-2.0
```

---

## Configuration (`config.json`)

All UI options are driven by `config.json` loaded at runtime:

```json
{
  "appName": "BPMN Architect",
  "appSubtitle": "Collaborative Enterprise Process Modeler",
  "appRoot": "",
  "appLogoIcon": "assets/img/bpmn-architect-logo.svg",
  "appLogoImage": "assets/img/bpmn-architect.svg",

  "endpoints": {
    "serviceUrl": "http://127.0.0.1:8002",
    "apiKey": "dev-master-key-12345",
    "dataStaticServeUrl": "/diagram_storage",
    "userInfoUrl": "assets/sample-data/user-info.json",
    "templatesRegistryUrl": "templates/templates.json"
  },

  "auth": {
    "masterKey": "dev-master-key-12345"
  },

  "features": {
    "enableLocking": true,
    "enableComments": true,
    "enableDirectSvgExport": true,
    "allowOfflineMode": true,
    "autoSaveDrafts": true
  },

  "sessions": {
    "heartbeatIntervalSec": 15,
    "idleTimeoutMin": 15
  }
}
```

| Property | Description |
| :--- | :--- |
| `endpoints.serviceUrl` | URL to the headless `bpmn-architect-service` microservice. |
| `endpoints.apiKey` / `auth.masterKey` | Master key sent via `X-Master-Key` when `AUTH_METHOD=master-key`. |
| `endpoints.dataStaticServeUrl` | Path to static filestore where `{id}.bpmn` and `{id}.svg` are hosted for HA offline viewing. |
| `endpoints.userInfoUrl` | Endpoint returning logged-in identity (`{ "username": "...", "name": "...", "role": "..." }`). |
| `features.enableLocking` | Toggles cooperative soft-locking and presence tracking. |
| `features.allowOfflineMode` | Toggles static filestore fallback when service is offline. |

---

## Local Development & Quick Start

Because `bpmn-architect-ui` contains zero server code, any static HTTP server works:

```bash
# Option 1: Python built-in static server
python3 -m http.server 8080

# Option 2: Node npx serve
npx serve -l 8080 .

# Option 3: VS Code Live Server extension
# Right-click index.html -> Open with Live Server
```

Open `http://localhost:8080/` in your modern web browser.

---

## Production Deployment

### Windows IIS

1. Create a new IIS Website or Virtual Directory pointing to this folder.
2. In IIS Manager, add MIME types if needed:
   - `.bpmn` &rarr; `application/xml`
   - `.svg` &rarr; `image/svg+xml`
   - `.json` &rarr; `application/json`
3. Optional: Map a virtual directory `/diagram_storage` pointing to your service's storage folder to enable static filestore fallback.

### Linux Nginx

```nginx
server {
    listen 80;
    server_name bpmn.company.org;
    root /var/www/bpmn-architect-ui;
    index index.html;

    # Static diagrams storage fallback
    location /diagram_storage/ {
        alias /var/data/bpmn-storage/;
        autoindex off;
        expires 1h;
    }

    # Proxy to FastAPI backend service
    location /api/ {
        proxy_pass http://127.0.0.1:8002/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## License

Apache-2.0. Copyright &copy; 2026 BPMN Architect / Unfoundry.

