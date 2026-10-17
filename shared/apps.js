/* Shared PMDG EFB extensions; model-specific APIs are passed by the entry wrapper. */
(function(){
function installGsxRemoteHost(bus, env) {
    const mode = 'L:FSDT_GSX_SET_REMOTECONTROL';
    const owned = 'L:PMDG_REMOTE_GSX_OWNED';
    const ca = 'L:PMDG_REMOTE_GSX_CA_LEASE';
    const fo = 'L:PMDG_REMOTE_GSX_FO_LEASE';
    const mine = env.side === 'CA' ? ca : fo;
    let selected = false;
    let stopped = false;
    let toolbarReady = false;
    let lastLive = false;
    const read = name => Number(SimVar.GetSimVarValue(name, 'number')) || 0;
    const write = (name, value) => SimVar.SetSimVarValue(name, 'number', value);
    function live() {
        return selected && env.screenOn() && !stopped;
    }
    function closeToolbar() {
        if (!toolbarReady || !live()) return;
        try {
            const task = Coherent.call('TOOLBAR_BUTTON_TOGGLE', 'PANEL_FSDT_GSX_PANEL', false);
            if (task && task.catch) task.catch(error => console.warn('GSX toolbar close', error));
        } catch (error) { console.warn('GSX toolbar close', error); }
    }
    let busy = false;
    async function update() {
        if (busy) return;
        busy = true;
        try {
            const now = Date.now();
            const active = live();
            await write(mine, active ? now : 0);
            const fresh = value => value > 0 && now - value >= 0 && now - value < 2500;
            const anyActive = active || fresh(read(ca)) || fresh(read(fo));
            if (anyActive && read(mode) !== 1) {
                // Only mark ownership when we change an unclaimed mode.
                await write(owned, 1);
                await write(mode, 1);
            } else if (!anyActive && read(owned) === 1) {
                await write(mode, 0);
                await write(owned, 0);
            }
            if (active && !lastLive) closeToolbar();
            lastLive = active;
        } catch (error) { console.warn('GSX remote ownership', error); }
        finally { busy = false; }
    }
    window.pmdgGsxRemoteReady = () => live() && read(mode) === 1;
    bus.getSubscriber().on('current_app').whenChanged().handle(app => {
        selected = app === 'gsx_remote';
        update();
    });
    const timer = setInterval(update, 500);
    try {
        RegisterViewListener('JS_LISTENER_TOOLBAR_PANELS', () => {
            toolbarReady = true;
            closeToolbar();
        });
    } catch (error) { console.warn('GSX toolbar listener', error); }
    window.addEventListener('beforeunload', () => {
        stopped = true;
        clearInterval(timer);
        update();
    });
}

function installRemoteApps(bus, env) {
    const home = document.getElementById("HomeScreen");
    const content = document.getElementById("AppContent");

    if (!home || !content || document.getElementById("remote-app-launchers")) {
        return;
    }

    installGsxRemoteHost(bus, env);
    const base = "/Pages/VCockpit/Instruments/PMDGTablet/shared";
    const publisher = bus.getPublisher();

    function gsxUrl() {
        let port = Math.round(
            SimVar.GetSimVarValue("L:FSDT_GSX_REMOTE_PORT", "number")
        );

        if (!(port >= 1 && port <= 65535)) {
            port = 8744;
        }

        return base + "/remoteClient/index.html"
            + "?transport=ws&host=127.0.0.1&port=" + port;
    }

    const apps = [
        {
            id: "gsx_remote",
            title: "GSX",
            url: gsxUrl
        },
        {
            id: "batc",
            title: "BeyondATC",
            url: () => base + "/beyondatc_toolbar/index.html"
        }
        // ,
        // {
        //     id: "youtube",
        //     title: "YouTube",
        //     url: () => base + "/web/youtube.html"
        // }
    ];

    const launchers = document.createElement("div");
    launchers.id = "remote-app-launchers";
    home.appendChild(launchers);

    apps.forEach(app => {
        const button = document.createElement("button");
        const icon = document.createElement("img");
        // icon.src = base + "/Assets/" + (
        //     app.id === "gsx_remote" ? "gsx_remote_icon.png" : "batc_icon.png"
        // );
        icon.src = base + "/Assets/" + app.id + "_icon.png";
        icon.alt = "";

        const label = document.createElement("span");
        label.textContent = app.title;

        button.appendChild(icon);
        button.appendChild(label);
        button.onclick = () => {
            env.unfocus();
            publisher.pub("current_app", app.id);
        };
        launchers.appendChild(button);

        const page = document.createElement("div");
        page.className = "efb_page remote-app-page";
        page.id = app.id;

        const frame = document.createElement("iframe");
        frame.title = app.title;
        frame.className = "remote-app-frame";

        page.appendChild(frame);
        content.appendChild(page);

        let loaded = false;

        bus.getSubscriber()
            .on("current_app")
            .whenChanged()
            .handle(current => {
                const active = current === app.id;
                page.style.display = active ? "block" : "none";

                // 第一次打开才加载，返回主页时保留页面和连接。
                if (active && !loaded) {
                    frame.src = app.url();
                    loaded = true;
                }

                if (!active) {
                    Coherent.trigger("UNFOCUS_INPUT_FIELD");
                }
            });

        // 两个页面来自同一个包，可为输入框绑定模拟器焦点处理。
        frame.addEventListener("load", () => {
            try {
                const doc = frame.contentDocument;
                if (!doc) return;

                doc.addEventListener("focusin", event => {
                    const tag = event.target.tagName;
                    if (tag === "INPUT" || tag === "TEXTAREA") {
                        Coherent.trigger(
                            "FOCUS_INPUT_FIELD",
                            "remoteAppInput", "", "", "", false
                        );
                    }
                });

                doc.addEventListener("focusout", () => {
                    Coherent.trigger("UNFOCUS_INPUT_FIELD");
                });
            } catch (error) {
                console.warn("Remote input bridge unavailable", error);
            }
        });
    });
    try {
        if (window.PMDGLandingAnalysis) {
            window.PMDGLandingAnalysis.install(bus, env.side, base);
        }
    } catch (error) {
        console.error("Landing Analysis initialization failed", error);
    }
    if(window.PMDGMultiJetways)window.PMDGMultiJetways.install(bus,base,env);
    if(window.PMDGSimBrief)window.PMDGSimBrief.install(bus,env,base);
    if(window.PMDGSimBriefAuthProbe)window.PMDGSimBriefAuthProbe.install(bus,env,base);
}


window.PMDGSharedApps={install:installRemoteApps};
})();
