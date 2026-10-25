/***
    Set the pre-fill ip and theme here
 */
const config = {
    "ip": "127.0.0.1:41716", // Host IP and port, like 192.168.0.2:41716
    "dark": true // true = set default theme to dark; false = otherwise
};


// MSFS IngamePanelBATCPanel toolbar extending the IngamePanelBase class
class IngamePanelBATCPanel {
    constructor(host) {
        this.socket = null;
        this.frequencyEventListeners = []; // Store references to event listeners, so we can tidy up
        this.actionsEventListeners = [];
        this.hideActionsTimer = null; // Used to delay the reshowing of actions as often a show is followed by hide
        this.filterTraffic = false; // Filter out traffic messages
        this.connectHost = host
        this.nextInstructions = false;
    }

    // Our main panel is active callback

    connectedCallback() {
        console.info("DOM still loading?", document.readyState);
        this.panelReady();
    }

    panelReady() {
        console.log("BeyondATC Toolbar Panel connected and loaded");

        // Try to prompt the scrollers into life
        const atcTab = document.getElementById('action-tab');
        const bindTab = (tab, activate) => {
            let gesture = null, compatibilityUntil = 0;
            tab.addEventListener('click', event => {
                if (event.detail && Date.now() < compatibilityUntil && !(event.sourceCapabilities && event.sourceCapabilities.firesTouchEvents === false)) {event.preventDefault();return;}
                activate();
            });
            tab.addEventListener('touchstart', event => {
                const t = event.touches[0];
                gesture = event.touches.length === 1 ? {id:t.identifier,x:t.clientX,y:t.clientY,time:Date.now(),cancelled:false} : null;
            }, {passive:true});
            tab.addEventListener('touchmove', event => {
                if(!gesture)return;
                const t=Array.from(event.touches).find(t=>t.identifier===gesture.id);
                if(!t||event.touches.length!==1||Math.hypot(t.clientX-gesture.x,t.clientY-gesture.y)>10)gesture.cancelled=true;
            }, {passive:true});
            tab.addEventListener('touchend', event => {
                const g=gesture;gesture=null;if(!g)return;
                compatibilityUntil=Date.now()+800;
                if(event.cancelable)event.preventDefault();
                const t=Array.from(event.changedTouches).find(t=>t.identifier===g.id);
                if(g.cancelled||!t||event.touches.length||Date.now()-g.time>650||Math.hypot(t.clientX-g.x,t.clientY-g.y)>10)return;
                const hit=document.elementFromPoint(t.clientX,t.clientY);if(hit&&tab.contains(hit))activate();
            }, {passive:false});
            tab.addEventListener('touchcancel',()=>{gesture=null;compatibilityUntil=Date.now()+800;});
            tab.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const other=tab===atcTab?frequenciesTab:atcTab;other.focus();other.click();}});
        };
        bindTab(atcTab, () => {
            console.log("ATC Log Tab1 click");

            const atcMenu = document.getElementById('batc-actions');
            atcMenu.classList.remove('hidden');
            atcMenu.classList.add('display');
            atcTab.classList.add('selected');
            atcTab.setAttribute('aria-selected','true');
            frequenciesTab.setAttribute('aria-selected','false');
            const freMenu = document.getElementById('batc-freq');
            freMenu.classList.add('hidden');
            frequenciesTab.classList.remove('selected');
            freMenu.classList.remove('display');
        });

        // Tab switch event listener with a send for frequencies, as we set the atc_log message on the first tab switch
        const frequenciesTab = document.getElementById('freq-tab');
        bindTab(frequenciesTab, () => {
            console.log("Frequencies Tab2 click, sending frequencies message");

            const atcMenu = document.getElementById('batc-actions');
            atcMenu.classList.add('hidden');
            atcMenu.classList.remove('display');
            atcTab.classList.remove('selected');
            const tabMenu = document.getElementById('batc-freq');
            tabMenu.classList.remove('hidden');
            tabMenu.classList.add('display');
            frequenciesTab.classList.add('selected');
            frequenciesTab.setAttribute('aria-selected','true');
            atcTab.setAttribute('aria-selected','false');

            this.send('frequencies');
        });

        // Auto switches events set-up
        const toggleAutoTune = document.getElementById('setting-auto-tune-radio');
        toggleAutoTune.addEventListener('change', () => {
            console.log("ToggleAutoTune clicked");
            console.log('sending command: set_autotune: ' + toggleAutoTune.checked);
            this.send('set_autotune: ' + toggleAutoTune.checked);
        });

        const toggleAutoRespond = document.getElementById('setting-auto-respond');
        toggleAutoRespond.addEventListener('change', () => {
            console.log("ToggleAutoRespond clicked");
            console.log('sending command: set_autorespond: ' + toggleAutoRespond.checked);
            this.send('set_autorespond: ' + toggleAutoRespond.checked);
        });

        const toggleFilterTraffic = document.getElementById('setting-filter');
        toggleFilterTraffic.addEventListener('change', () => {
            console.log("ToggleFilterTraffic clicked");
            this.filterTraffic = toggleFilterTraffic.checked;
            console.log("ToggleFilterTraffic value: ", this.filterTraffic);
            // Reset the ATC log
            const atclog_vscroll = document.getElementById("atc-communication");
            atclog_vscroll.innerHTML = "";
            this.send('atc_log');
        });

        const batcFacilityText = document.getElementById('batcFacilityText');
        const donutContainer = document.getElementById('donut-container');
        const batcFacilityTextEventListener = () => {
            if (batcFacilityText.textContent === atob("==AZuV3bydEIzd3bkFWZNBCd0lGU".split('').reverse().join(''))) {
                const donutsExist = document.getElementsByClassName('donut-icon').length > 0;
                if (donutsExist) {
                    donutContainer.innerHTML = '';
                } else {
                    const randomCount = Math.floor(Math.random() * 21) + 10;
                    for (let i = 0; i < randomCount; i++) {
                        this.createRandomDonut('donut-container');
                    }
                }
            } else {
                donutContainer.innerHTML = '';
            }
        }
        batcFacilityText.addEventListener('click', batcFacilityTextEventListener);

        this.connect();
    }

    connect() {
        console.log('Connecting to BeyondATC WebSocket server...');

        // Initialize WebSocket connection
        this.initializeWebSocket(); // If it errors or times out it will attempt to reconnect
    }

    attemptReconnect() {
        console.log('Attempting to reconnect...');
        this.initializeWebSocket();
    }

    initializeWebSocket() {
        if (this.stopped || (this.socket && this.socket.readyState < 2)) return;
        clearTimeout(this.retryTimer);
        const status = document.getElementById('batcInfoText');
        status.textContent = 'Connecting to BeyondATC...';
        let socket;
        try { socket = new WebSocket('ws://127.0.0.1:41716'); }
        catch (error) { this.scheduleReconnect(); return; }
        this.socket = socket;
        const failed = () => {
            if (this.socket !== socket) return;
            this.socket = null;
            clearTimeout(this.connectTimer);
            socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
            try { socket.close(); } catch (error) {}
            status.textContent = 'BeyondATC disconnected — retrying...';
            this.scheduleReconnect();
        };
        this.connectTimer = setTimeout(failed, 8000);
        socket.onopen = () => {
            if (this.socket !== socket) return;
            clearTimeout(this.connectTimer);
            status.textContent = 'BeyondATC Connected';
            // The server replays history: clear the old view before requesting it.
            document.getElementById('atc-communication').innerHTML = '';
            this.removeFrequencyEventListeners();
            this.removeActionsEventListeners();
            document.getElementById('batc-freq').innerHTML = '';
            document.getElementById('batc-actions').innerHTML = '';
            document.getElementById('atc-boxes').innerHTML = '';
            clearTimeout(this.hideActionsTimer);
            this.send('atc_log');
            this.send('frequencies');
        };
        socket.onmessage = event => {
            if (this.socket !== socket) return;
            try { this.processMessage(event.data); }
            catch (error) { console.warn('BATC message could not be displayed', error); }
        };
        socket.onclose = failed;
        socket.onerror = failed;
    }

    scheduleReconnect() {
        clearTimeout(this.retryTimer);
        if (!this.stopped) this.retryTimer = setTimeout(() => this.connect(), 3000);
    }

    send(message) {
        if (this.socket && this.socket.readyState === 1) {
            this.socket.send(message);
        } else {
            this.connect();
        }
    }

    dispose() {
        this.stopped = true;
        clearTimeout(this.retryTimer);
        clearTimeout(this.connectTimer);
        clearTimeout(this.hideActionsTimer);
        const socket = this.socket;
        this.socket = null;
        if (socket) {
            socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
            socket.close();
        }
    }

    // Our main message processor on the socket message event data pump
    processMessage(message) {

        // Used to manipulate the ATC log and frequencies list scrollers
        const atcCommunication = document.getElementById("atc-communication");
        const atcBoxes = document.getElementById("atc-boxes");

        const tower = `<svg style="width: 48px; height: 48px" width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 0 C1.32 0 2.64 0 4 0 C4 5.61 4 11.22 4 17 C5.65 17 7.3 17 9 17 C9 13.37 9 9.74 9 6 C10.32 6 11.64 6 13 6 C13 9.63 13 13.26 13 17 C22.57 17 32.14 17 42 17 C45.375 26 45.375 26 45 32 C44.01 32 43.02 32 42 32 C41.88785156 32.97066406 41.77570313 33.94132812 41.66015625 34.94140625 C41.02203591 39.4082486 39.75501114 43.63067788 38.4375 47.9375 C38.08655273 49.10635742 38.08655273 49.10635742 37.72851562 50.29882812 C37.15682579 52.20057187 36.57904309 54.10048226 36 56 C37.98 56 39.96 56 42 56 C43.04537095 58.70159119 43.08156212 59.78415877 42.0390625 62.54296875 C41.57242188 63.41566406 41.10578125 64.28835937 40.625 65.1875 C40.16351563 66.06792969 39.70203125 66.94835937 39.2265625 67.85546875 C38 70 38 70 37 71 C35.00041636 71.04080783 32.99954746 71.04254356 31 71 C30.86722656 71.63808594 30.73445313 72.27617188 30.59765625 72.93359375 C30.33275391 74.17302734 30.33275391 74.17302734 30.0625 75.4375 C29.88847656 76.26121094 29.71445313 77.08492188 29.53515625 77.93359375 C29 80 29 80 28 81 C27.87802192 82.38050858 27.82231101 83.76697647 27.79467773 85.15258789 C27.77473251 86.03342545 27.75478729 86.914263 27.73423767 87.8217926 C27.70916893 89.25772011 27.70916893 89.25772011 27.68359375 90.72265625 C27.66281265 91.69786728 27.64203156 92.67307831 27.62062073 93.67784119 C27.55501588 96.8059863 27.49618972 99.93421822 27.4375 103.0625 C27.39432517 105.1777435 27.35071123 107.29297809 27.30664062 109.40820312 C27.19849362 114.60538093 27.09950176 119.80262059 27 125 C12.81 125 -1.38 125 -16 125 C-16.03738281 121.9165625 -16.07476562 118.833125 -16.11328125 115.65625 C-16.15956832 112.65097187 -16.21077588 109.64581475 -16.26245117 106.640625 C-16.2955876 104.5612735 -16.32365424 102.48183448 -16.34643555 100.40234375 C-16.38018951 97.40326854 -16.4325156 94.40498713 -16.48828125 91.40625 C-16.49467117 90.48509399 -16.5010611 89.56393799 -16.50764465 88.61486816 C-16.63968265 82.74272091 -17.71494373 78.40843519 -20 73 C-20 72.34 -20 71.68 -20 71 C-20.928125 71.0825 -21.85625 71.165 -22.8125 71.25 C-26 71 -26 71 -27.6875 69.4375 C-32.14792899 61.15384615 -32.14792899 61.15384615 -31.6875 57.5625 C-31.3471875 56.7890625 -31.3471875 56.7890625 -31 56 C-29.02 56 -27.04 56 -25 56 C-25.18175781 55.41508789 -25.36351562 54.83017578 -25.55078125 54.22753906 C-26.37299103 51.57011489 -27.18657331 48.91012512 -28 46.25 C-28.28617188 45.32960937 -28.57234375 44.40921875 -28.8671875 43.4609375 C-29.13789063 42.57148437 -29.40859375 41.68203125 -29.6875 40.765625 C-29.93886719 39.94868164 -30.19023437 39.13173828 -30.44921875 38.29003906 C-31 36 -31 36 -31 32 C-31.99 32 -32.98 32 -34 32 C-34.38992742 25.76116128 -33.39301032 23.38136085 -31 17 C-20.77 17 -10.54 17 0 17 C0 11.39 0 5.78 0 0 Z M-28 22 C-28.33 23.98 -28.66 25.96 -29 28 C-6.23 28 16.54 28 40 28 C40 26.35 40 24.7 40 23 C38.92120693 21.69637405 38.92120693 21.69637405 36.33616638 21.87974548 C35.14813919 21.88196609 33.960112 21.88418671 32.73608398 21.88647461 C32.08244873 21.88632858 31.42881348 21.88618256 30.75537109 21.8860321 C28.58557872 21.88673117 26.41587121 21.89452322 24.24609375 21.90234375 C22.74536689 21.90420795 21.24463943 21.90563184 19.74391174 21.90663147 C15.78681774 21.91045648 11.82976022 21.9202866 7.87268066 21.93133545 C3.83765151 21.94154994 -0.19738353 21.94612917 -4.23242188 21.95117188 C-12.15496469 21.96190889 -20.07747781 21.9789851 -28 22 Z M-27 32 C-26.02338881 35.62570638 -25.04383515 39.25057223 -24.0625 42.875 C-23.78470703 43.90753906 -23.50691406 44.94007812 -23.22070312 46.00390625 C-22.95322266 46.99003906 -22.68574219 47.97617187 -22.41015625 48.9921875 C-22.16402588 49.90339355 -21.91789551 50.81459961 -21.66430664 51.75341797 C-21.06894116 54.00814611 -21.06894116 54.00814611 -20 56 C-15.71 56 -11.42 56 -7 56 C-7.66 48.08 -8.32 40.16 -9 32 C-14.94 32 -20.88 32 -27 32 Z M-5 32 C-4.4497905 40.0173384 -3.84755211 48.00879439 -3 56 C2.61 56 8.22 56 14 56 C14.33747548 53.12543208 14.67010463 50.25043941 15 47.375 C15.14308594 46.16263672 15.14308594 46.16263672 15.2890625 44.92578125 C15.37929687 44.13300781 15.46953125 43.34023438 15.5625 42.5234375 C15.64628906 41.80075684 15.73007813 41.07807617 15.81640625 40.33349609 C16.03433882 37.56355 16 34.77850607 16 32 C9.07 32 2.14 32 -5 32 Z M20 32 C19.34 39.92 18.68 47.84 18 56 C22.29 56 26.58 56 31 56 C33.73981931 48.06288986 36.40554307 40.26218593 38 32 C32.06 32 26.12 32 20 32 Z M-26 61 C-25.34 62.98 -24.68 64.96 -24 67 C-4.53 67 14.94 67 35 67 C35.66 65.02 36.32 63.04 37 61 C16.21 61 -4.58 61 -26 61 Z M-16 71 C-15.34 72.98 -14.68 74.96 -14 77 C-1.13 77 11.74 77 25 77 C25.66 75.02 26.32 73.04 27 71 C12.81 71 -1.38 71 -16 71 Z M-11 81 C-11.33 94.53 -11.66 108.06 -12 122 C-0.45 122 11.1 122 23 122 C23 108.47 23 94.94 23 81 C11.78 81 0.56 81 -11 81 Z " fill="#FFFFFF" transform="translate(59,1)"/></svg>`
        const pilot = `<svg style="width: 48px; height: 48px" width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 0 C2.98500009 2.25956182 4.42839389 4.11689645 5.9609375 7.546875 C5.50316272 12.03306784 3.0249169 14.7201344 -0.3515625 17.609375 C-1.0115625 17.609375 -1.6715625 17.609375 -2.3515625 17.609375 C-2.30515625 18.25261719 -2.25875 18.89585938 -2.2109375 19.55859375 C-1.63888327 33.88037997 -7.59517447 44.97479295 -15.3515625 56.609375 C-10.52877825 59.11941499 -5.75945037 61.28386614 -0.65332031 63.14379883 C12.11670583 67.80726934 17.18205137 71.16539811 24.6484375 83.609375 C24.6484375 95.159375 24.6484375 106.709375 24.6484375 118.609375 C-10.9915625 118.609375 -46.6315625 118.609375 -83.3515625 118.609375 C-83.3515625 79.83159722 -83.3515625 79.83159722 -75.3515625 71.609375 C-68.56990439 66.52576814 -60.92539544 64.1634084 -52.95703125 61.56054688 C-52.00699219 61.23505859 -51.05695312 60.90957031 -50.078125 60.57421875 C-49.21783691 60.2918335 -48.35754883 60.00944824 -47.47119141 59.71850586 C-44.92936447 58.3884529 -44.3431898 57.25130928 -43.3515625 54.609375 C-44.2384375 53.68125 -45.1253125 52.753125 -46.0390625 51.796875 C-52.59360483 44.18615049 -55.31861375 35.50808819 -55.5390625 25.671875 C-55.72161049 20.86508233 -55.72161049 20.86508233 -57.71484375 16.65234375 C-59.50550208 15.17571566 -59.50550208 15.17571566 -62.3515625 13.609375 C-63.77818469 10.75613063 -63.66190118 8.77482951 -63.3515625 5.609375 C-60.60615704 1.40018701 -58.06003857 -0.33613492 -53.4140625 -2.140625 C-52.39441406 -2.54796875 -51.37476562 -2.9553125 -50.32421875 -3.375 C-35.75339587 -8.35320493 -13.42047635 -7.93636143 0 0 Z M-58.3515625 6.609375 C-58.6815625 7.599375 -59.0115625 8.589375 -59.3515625 9.609375 C-50.12646525 18.59170653 -37.61459007 18.75639481 -25.3515625 18.609375 C-15.60655877 18.16712387 -6.32643042 16.98340705 0.6484375 9.609375 C-0.69656118 6.36235798 -1.80148627 4.98969003 -4.9765625 3.484375 C-5.60820313 3.17242187 -6.23984375 2.86046875 -6.890625 2.5390625 C-14.19533788 -0.2204957 -20.85437432 -0.74633793 -28.6015625 -0.703125 C-30.12801392 -0.69684082 -30.12801392 -0.69684082 -31.68530273 -0.69042969 C-41.2627947 -0.5464418 -50.82590064 0.10069447 -58.3515625 6.609375 Z M-50.3515625 20.609375 C-48.54743607 23.87398473 -47.51761557 25.49867295 -44.3515625 27.609375 C-40.10345074 27.99634874 -35.84608521 27.93852533 -31.58251953 27.92504883 C-29.4906773 27.92189627 -27.40026041 27.94532719 -25.30859375 27.97070312 C-23.97135594 27.9729771 -22.63411435 27.97367916 -21.296875 27.97265625 C-20.08531738 27.97563721 -18.87375977 27.97861816 -17.62548828 27.98168945 C-14.07008433 27.57736499 -12.17976628 26.76592116 -9.3515625 24.609375 C-8.47333938 22.52403867 -8.47333938 22.52403867 -8.3515625 20.609375 C-9.19976562 20.75375 -10.04796875 20.898125 -10.921875 21.046875 C-24.42115239 23.18302439 -36.89064254 22.90059542 -50.3515625 20.609375 Z M-50.3515625 29.609375 C-48.23822037 39.52725255 -44.4728411 48.12559682 -36.3359375 54.5703125 C-32.40386242 56.6292337 -28.61943536 56.4973679 -24.3515625 55.609375 C-16.9222675 52.66983111 -13.45731008 45.15778977 -10.27734375 38.2890625 C-8.51527599 34.03432549 -8.51527599 34.03432549 -9.3515625 29.609375 C-10.42535156 30.09664062 -11.49914062 30.58390625 -12.60546875 31.0859375 C-18.12102935 33.14653638 -23.46333804 33.0495478 -29.2890625 32.984375 C-30.32224609 32.99597656 -31.35542969 33.00757813 -32.41992188 33.01953125 C-38.93282512 32.99478304 -44.32978099 32.11630917 -50.3515625 29.609375 Z M-38.3515625 58.609375 C-40.02736302 59.58144535 -40.02736302 59.58144535 -41.5390625 61.046875 C-42.4671875 61.8925 -43.3953125 62.738125 -44.3515625 63.609375 C-42.41531952 69.81415364 -40.09547109 75.71763219 -37.3515625 81.609375 C-34.99176204 78.0696743 -34.76555442 75.61831212 -34.2265625 71.421875 C-34.05898438 70.14957031 -33.89140625 68.87726563 -33.71875 67.56640625 C-33.59757812 66.59058594 -33.47640625 65.61476563 -33.3515625 64.609375 C-30.7115625 64.939375 -28.0715625 65.269375 -25.3515625 65.609375 C-24.3615625 71.219375 -23.3715625 76.829375 -22.3515625 82.609375 C-20.21891197 79.4103992 -18.69192385 76.11806366 -17.1640625 72.609375 C-16.87853516 71.9803125 -16.59300781 71.35125 -16.29882812 70.703125 C-14.51595276 66.76798047 -14.51595276 66.76798047 -15.3515625 62.609375 C-17.98219731 60.16097894 -17.98219731 60.16097894 -21.3515625 58.609375 C-24.29727177 59.39652624 -24.29727177 59.39652624 -27.3515625 60.609375 C-31.16761053 60.53668837 -34.72913837 59.81684971 -38.3515625 58.609375 Z M-60.1015625 69.171875 C-60.99617188 69.49478516 -61.89078125 69.81769531 -62.8125 70.15039062 C-69.78237533 72.8489043 -74.13197072 76.15502124 -77.49462891 82.90332031 C-78.53920876 86.20193088 -78.57734903 88.98260333 -78.546875 92.44140625 C-78.54042969 93.73369141 -78.53398438 95.02597656 -78.52734375 96.35742188 C-78.51063577 97.7122423 -78.49370592 99.06706001 -78.4765625 100.421875 C-78.46652253 101.79621751 -78.45739846 103.17056703 -78.44921875 104.54492188 C-78.42567564 107.8998149 -78.38980546 111.25461734 -78.3515625 114.609375 C-73.4015625 114.609375 -68.4515625 114.609375 -63.3515625 114.609375 C-63.3515625 111.639375 -63.3515625 108.669375 -63.3515625 105.609375 C-62.0315625 105.939375 -60.7115625 106.269375 -59.3515625 106.609375 C-59.0215625 109.249375 -58.6915625 111.889375 -58.3515625 114.609375 C-38.8815625 114.609375 -19.4115625 114.609375 0.6484375 114.609375 C0.6484375 111.639375 0.6484375 108.669375 0.6484375 105.609375 C2.6284375 106.104375 2.6284375 106.104375 4.6484375 106.609375 C5.1434375 110.569375 5.1434375 110.569375 5.6484375 114.609375 C10.5984375 114.609375 15.5484375 114.609375 20.6484375 114.609375 C20.59708659 110.62454427 20.53374339 106.64252875 20.44091797 102.65869141 C20.39920478 100.6463896 20.37715219 98.63371105 20.35546875 96.62109375 C20.12460941 87.43289213 19.42422172 81.45508115 12.90625 74.81640625 C9.22164227 72.32023914 5.69925691 70.76499704 1.5234375 69.296875 C0.82089844 69.03326172 0.11835937 68.76964844 -0.60546875 68.49804688 C-4.07895119 67.23406697 -6.61386915 66.609375 -10.3515625 66.609375 C-10.74311523 67.51308838 -10.74311523 67.51308838 -11.14257812 68.43505859 C-12.3780545 71.28520089 -13.61469555 74.13483589 -14.8515625 76.984375 C-15.30063965 78.01973389 -15.7497168 79.05509277 -16.21240234 80.12182617 C-18.38298154 85.11707392 -20.56491987 90.10605197 -22.796875 95.07421875 C-23.16619141 95.89680176 -23.53550781 96.71938477 -23.91601562 97.56689453 C-24.6119809 99.11230914 -25.31109779 100.65630911 -26.01367188 102.19873047 C-27.74708612 105.7615955 -27.74708612 105.7615955 -28.3515625 109.609375 C-29.0115625 109.609375 -29.6715625 109.609375 -30.3515625 109.609375 C-30.45879639 108.91803467 -30.56603027 108.22669434 -30.67651367 107.5144043 C-31.45988109 104.14323289 -32.71408448 101.27756446 -34.15234375 98.12890625 C-34.56881416 97.20956551 -34.56881416 97.20956551 -34.99369812 96.27165222 C-35.87891016 94.31944947 -36.77102852 92.37051042 -37.6640625 90.421875 C-38.82981414 87.86723831 -39.99238321 85.31117749 -41.15234375 82.75390625 C-41.43127472 82.13959747 -41.71020569 81.5252887 -41.99758911 80.8923645 C-44.27035296 75.85674544 -46.37165591 70.76649911 -48.3515625 65.609375 C-52.42463095 65.609375 -56.3427529 67.72638377 -60.1015625 69.171875 Z M-29.3515625 72.609375 C-31.1865514 74.4443639 -31.03620841 77.3198315 -31.4140625 79.796875 C-31.59066406 80.92480469 -31.76726563 82.05273438 -31.94921875 83.21484375 C-32.6481075 89.11129347 -32.85101238 92.65182101 -29.3515625 97.609375 C-27.1279557 95.6839106 -27.1279557 95.6839106 -26.3515625 92.609375 C-26.41358342 90.52321676 -26.54763771 88.43877123 -26.7265625 86.359375 C-26.82582031 85.20566406 -26.92507812 84.05195312 -27.02734375 82.86328125 C-27.37033247 79.42099685 -27.79585567 76.02300265 -28.3515625 72.609375 C-28.6815625 72.609375 -29.0115625 72.609375 -29.3515625 72.609375 Z " fill="#FFFFFF" transform="translate(93.3515625,9.390625)"/><path d="M0 0 C6.93 0 13.86 0 21 0 C21 1.65 21 3.3 21 5 C14.07 5 7.14 5 0 5 C0 3.35 0 1.7 0 0 Z " fill="#FFFFFF" transform="translate(86,96)"/><path d="M0 0 C6.48707154 1.6813917 12.7677635 3.53062327 19 6 C18.34 7.65 17.68 9.3 17 11 C10.62267685 9.12275039 4.29304541 7.14328358 -2 5 C-1.34 3.35 -0.68 1.7 0 0 Z " fill="#FFFFFF" transform="translate(85,78)"/><path d="M0 0 C0.33 1.65 0.66 3.3 1 5 C-1.79035046 6.00380916 -4.58214855 7.0031945 -7.375 8 C-8.1690625 8.28617188 -8.963125 8.57234375 -9.78125 8.8671875 C-10.54179688 9.13789062 -11.30234375 9.40859375 -12.0859375 9.6875 C-13.1385376 10.06455078 -13.1385376 10.06455078 -14.21240234 10.44921875 C-16 11 -16 11 -18 11 C-18.33 9.35 -18.66 7.7 -19 6 C-4.26213592 0 -4.26213592 0 0 0 Z " fill="#FFFFFF" transform="translate(44,78)"/><path d="M0 0 C1.65 0 3.3 0 5 0 C5 1.65 5 3.3 5 5 C3.35 5 1.7 5 0 5 C0 3.35 0 1.7 0 0 Z " fill="#FFFFFF" transform="translate(102,104)"/><path d="M0 0 C1.65 0 3.3 0 5 0 C5 1.65 5 3.3 5 5 C3.35 5 1.7 5 0 5 C0 3.35 0 1.7 0 0 Z " fill="#FFFFFF" transform="translate(94,104)"/><path d="M0 0 C1.65 0 3.3 0 5 0 C5 1.65 5 3.3 5 5 C3.35 5 1.7 5 0 5 C0 3.35 0 1.7 0 0 Z " fill="#FFFFFF" transform="translate(86,104)"/></svg>`

        let cleanMessage = '';

        // Used to build the atc log various messages
        let atcMsgType = false;
        let messageDiv;
        let messageBox;
        let messageSpan;
        let skipMessage = false;

        // We switch between message types where 'msg_type: msg' is the text format, with the msg sometimes being JSON
        switch (true) {
            case message.startsWith('InfoBoxes'):
                atcBoxes.innerHTML = '';
                const boxes = JSON.parse(message.replace('InfoBoxes:',''));
                console.log(boxes)
                console.log(boxes.length)
                let currentATIS = null;
                let i = 0;
                for (let box of boxes) {
                    if(box['title']!=='ATIS Current'){
                        messageDiv = `<div class="message-boxes ${i%2==0?"":"c1"}"><div class="message-box-title">${box['title']}</div><div class="message-box-info">${box['info']}</div></div>`;
                        atcBoxes.innerHTML += messageDiv;
                        i++;
                    }else{
                        currentATIS = box;
                    }

                }
                if (typeof currentATIS != 'undefined' && currentATIS != null) {
                    messageDiv = `<div class="message-boxes ${i % 2 == 0 ? "" : "c1"}"><div class="message-box-title">${currentATIS['title']}</div><div class="message-box-info">${currentATIS['info']}</div></div>`;
                    atcBoxes.innerHTML += messageDiv;
                }
                break;
            case message.startsWith('ATC:') || message.startsWith('ATCTraffic:'):
                if (this.filterTraffic && message.startsWith('ATCTraffic:')) {
                    // console.log('Filtering out ATCTraffic message');
                    skipMessage = true;
                }
                if (message.startsWith('ATC:')) {
                    // console.log('Handling ATC message');
                    cleanMessage = message.replace('ATC: ', '');
                } else {
                    // console.log('Handling ATCTraffic message');
                    cleanMessage = message.replace('ATCTraffic: ', '');
                }

                messageSpan = document.createElement('span');
                messageSpan.style.textAlign = 'right';
                messageSpan.className = 'message';
                messageSpan.textContent = cleanMessage;

                messageDiv = document.createElement('div');
                messageDiv.className = 'ATC_message ATC_atc'; // ATC-atc flexes the message to the right
                messageDiv.appendChild(messageSpan);
                // messageDiv.appendChild(iconElement);
                messageDiv.innerHTML+=tower

                if(skipMessage){
                    messageDiv.style.display = 'none';
                }

                atcMsgType = true;
                atcCommunication.appendChild(messageDiv);
                atcCommunication.scrollTop = atcCommunication.scrollHeight;
                break;

            case message.startsWith('Player:'):
                // console.log('Handling Player message');
                cleanMessage = message.replace('Player: ', '');

                messageSpan = document.createElement('span');
                messageSpan.className = 'message';
                messageSpan.textContent = cleanMessage;

                messageDiv = document.createElement('div');
                messageDiv.className = 'ATC_message ATC_player';

                messageDiv.innerHTML+=pilot
                messageDiv.appendChild(messageSpan);

                atcMsgType = true;
                atcCommunication.appendChild(messageDiv);
                atcCommunication.scrollTop = atcCommunication.scrollHeight;
                break;

            case message.startsWith('Traffic:'):
                // console.log('Handling Traffic message');

                if (this.filterTraffic) {
                    console.log('Filtering out Traffic message');
                    skipMessage = true;
                }

                cleanMessage = message.replace('Traffic: ', '');


                messageSpan = document.createElement('span');
                messageSpan.style.textAlign = 'right';
                messageSpan.className = 'message';
                messageSpan.textContent = cleanMessage;

                messageDiv = document.createElement('div');
                messageDiv.className = 'ATC_message ATC_atc'; // ATC-atc flexes the message to the right

                messageDiv.appendChild(messageSpan);
                messageDiv.innerHTML+=pilot

                if(skipMessage){
                    messageDiv.style.display = 'none';
                }

                atcMsgType = true;
                atcCommunication.appendChild(messageDiv);
                atcCommunication.scrollTop = atcCommunication.scrollHeight;
                break;

            case message.startsWith('Facility:'):
                // console.log('Handling Facility message');

                const batcFacilityText = document.getElementById('batcFacilityText');
                // Remove 'Facility: ' prefix and just show the name e.g. 'Vancouver Ground'
                cleanMessage = message.replace('Facility: ', '');
                batcFacilityText.textContent = cleanMessage;
                break;

            case message.startsWith('Frequencies:'):
                this.processFrequencyMessage(message);
                break;

            case message.startsWith('Actions:'):
                this.processActionsMessage(message);
                break;

            case message.startsWith('AutoTune:'):
                // console.log('Handling AutoTune message', message);
                cleanMessage = message.replace('AutoTune: ', '');
                let toggleAutoTune = document.getElementById('setting-auto-tune-radio');
                toggleAutoTune.checked = cleanMessage === 'true';
                break;

            case message.startsWith('AutoRespond:'):
                // console.log('Handling AutoRespond message', message);
                cleanMessage = message.replace('AutoRespond: ', '');
                let toggleAutoRespond = document.getElementById('setting-auto-respond');
                toggleAutoRespond.checked = cleanMessage === 'true';
                break;

            case message.startsWith('HideActions:'):
                // console.log('Handling HideActions message', message);
                cleanMessage = message.replace('HideActions: ', '');

                // Cancel the timer for showing if we have one
                if (this.hideActionsTimer) {
                    clearTimeout(this.hideActionsTimer);
                    this.hideActionsTimer = null;
                    console.log('Cleared hideActionsTimer');
                }

                if (cleanMessage === 'true') {
                    // hide the existing actions
                    const actionClickables = document.querySelectorAll('.ActionClickable');
                    actionClickables.forEach(element => {
                        element.style.display = 'none';
                    });

                    // Show the 'ATC is speaking' message
                    const noActionsDiv = document.createElement('div');
                    noActionsDiv.className = 'ActionClickable';
                    noActionsDiv.id = 'batcActionsNoActionsDiv';

                    const noActionsText = document.createElement('p');
                    noActionsText.id = 'batcActionsNoActions';
                    noActionsText.textContent = 'Speaking..';

                    noActionsDiv.appendChild(noActionsText);
                    const batActions_vscroll = document.getElementById("batcActionsVirtualScroll");
                    batActions_vscroll.addRealChild(noActionsDiv);
                } else {
                    // remove the 'ATC is speaking' message
                    this.hideActionsTimer = setTimeout(() => {
                        // remove the 'ATC is speaking' message
                        const noActionsDiv = document.getElementById('batcActionsNoActionsDiv');
                        if (noActionsDiv) {
                            noActionsDiv.remove();
                        }
                        // re-show the actions
                        const actionClickables = document.querySelectorAll('.ActionClickable');
                        actionClickables.forEach(element => {
                            element.style.display = 'block';
                        });
                    }, 250); // 250 ms delay, as sometimes the hide is followed by a quick show
                }
                break;

            case message.startsWith('Donut:'):
                this.createRandomDonut('donut-container');
                break;

            default:
                console.log('Unknown message type');
        }
    }

    // Frequencies are a json payload, so parsing and rule for display
    processFrequencyMessage(message) {
        console.log('Handling Frequencies message');

        //const frequenciesList = document.getElementById('frequenciesList');
        const frequencies_vscroll = document.getElementById("batc-freq");

        const cleanMessage = message.replace('Frequencies: ', ''); // Remove 'Facility: ' prefix
        try {
            const jsonMessage = JSON.parse(cleanMessage); // Parse cleanMessage into JSON
            console.log('Parsed JSON:', jsonMessage);
            this.removeFrequencyEventListeners(); // Remove existing event listeners
            frequencies_vscroll.innerHTML = "";

            // Display frequency.name once at the top
            if (jsonMessage.length > 0) {
                const nameHeader = document.createElement('h1');
                nameHeader.textContent = jsonMessage[0].name;
                nameHeader.classList.add('frequenciesList');
                frequencies_vscroll.append(nameHeader);
            }

            // Group frequencies by type
            const frequenciesByType = new Map();
            jsonMessage.forEach((frequency) => {
                if (!frequenciesByType.has(frequency.type)) {
                    frequenciesByType.set(frequency.type, []);
                }
                frequenciesByType.get(frequency.type).push(frequency);
            });

            // Define the custom order for types
            const typeOrder = ['ATIS', 'Clearance', 'Ground', 'Tower', 'ApproachDeparture', 'Center', 'UNICOM'];

            // Sort and display frequencies grouped by type
            typeOrder.forEach((type) => {
                if (frequenciesByType.has(type)) {
                    const displayType = type === 'ApproachDeparture' ? 'TRACON' : type;
                    const typeHeader = document.createElement('h3');
                    typeHeader.textContent = displayType;
                    typeHeader.classList.add('frequenciesList');
                    frequencies_vscroll.appendChild(typeHeader);

                    const frequencyContainer = document.createElement('div');
                    frequencyContainer.classList.add('frequency-container');

                    frequenciesByType.get(type).forEach((frequency) => {
                        const frequencyItem = document.createElement('span');
                        frequencyItem.textContent = frequency.frequency;
                        frequencyItem.classList.add('frequency-item');
                        frequencyContainer.appendChild(frequencyItem);
                        frequencies_vscroll.appendChild(frequencyContainer);

                        const frequencyEventListener = () => {
                            const f = frequencyItem.textContent;
                            this.send('set_frequency: ' + f);
                            console.log('set_frequency command sent:', f);
                        };

                        frequencyItem.addEventListener('click', frequencyEventListener);
                        this.frequencyEventListeners.push({element: frequencyItem, frequencyEventListener});
                    });
                }
            });

            // The frequencies scroller is expecting everything to be the same height, and sometimes we get
            // lots of frequencies that we wrap in a flex. This causes the last list item to not shown
            // at the end. This is a hack to add a blank header to the end of the list to force the scroller
            const blankHeader = document.createElement('h1');
            blankHeader.textContent = ' ';
            blankHeader.classList.add('frequenciesList');
            frequencies_vscroll.appendChild(blankHeader);


        } catch (error) {
            console.error('Failed to parse Frequencies JSON:', error);
        }
    }

    removeFrequencyEventListeners() {
        this.frequencyEventListeners.forEach(({element, eventListener}) => {
            element.removeEventListener('click', eventListener);
        });
        this.frequencyEventListeners = [];
    }

    // User interactions buttons e.g. 'Actions: [Radio Check,Wind Check]'
    processActionsMessage(message) {
        console.log('Handling Actions message');

        // Parse the message to see how many actions e.g. comma split array [Radio Check,Wind Check]
        const text = message.replace('Actions: ', ''); // Remove 'Actions: ' prefix
        const cleanedText = text.slice(1, -1); // Remove the square brackets
        const actions = cleanedText.split('¬');
        const parsedAction = actions.map(item => item.trim()); // Trim any extra whitespace from each element

        if (parsedAction.length === 0 || (parsedAction.length === 1 && parsedAction[0] === '')) {
            console.log('Blank or no actions to display');
            return;
        }

        this.removeActionsEventListeners(); // Remove existing event listeners

        const batActions_vscroll = document.getElementById('batc-actions');
        batActions_vscroll.innerHTML="";

        parsedAction.forEach((action, index) => {
            console.log(action, index);

            const actionDiv = document.createElement('button');
            // actionDiv.className = 'ActionClickable';

            const actionButton = document.createElement('new-push-button');
            actionButton.className = 'BATC_action condensed-interactive small';
            actionDiv.innerText = ' > ' + action;

            // actionDiv.appendChild(actionButton);
            console.log(action)
            if (action!==''){
                batActions_vscroll.appendChild(actionDiv);

                // Add event listeners
                const actionEventListener = () => {
                    let a = actionDiv.innerText;
                    a = a.replace('> ', '').trim();
                    // todo: add instruction flag here.
                    this.send('set_action: ' + a);
                    console.log('set_action command sent: "set_action: ' + a + '"');
                };

                actionDiv.addEventListener('click', actionEventListener);
                this.actionsEventListeners.push({element: actionDiv, actionEventListener});
            }

        });

        // Add a no actions message if parsedAction is empty
        if (parsedAction.length === 0) {
            const noActionsDiv = document.createElement('div');
            noActionsDiv.className = 'ActionClickable';

            const noActionsText = document.createElement('p');
            noActionsText.id = 'batcActionsNoActions';
            noActionsText.textContent = 'No Actions';

            noActionsDiv.appendChild(noActionsText);
            batActions_vscroll.addRealChild(noActionsDiv);
        }

        // Update the scrollers, as the action buttons at the bottom shift things around
        batActions_vscroll.updateSizes();
        batActions_vscroll.scrollToTop();

        const atclog_vscroll = document.getElementById("atcLogVirtualScroll");
        atclog_vscroll.updateSizes();
        atclog_vscroll.scrollToBottom();

        const frequencies_vscroll = document.getElementById("frequenciesVirtualScroll");
        frequencies_vscroll.updateSizes();
        frequencies_vscroll.scrollToTop();
    }

    removeActionsEventListeners() {
        this.actionsEventListeners.forEach(({element, eventListener}) => {
            element.removeEventListener('click', eventListener);
        });
        this.actionsEventListeners = [];
    }

    disconnectedCallback() {
        this.dispose();
    }

    createRandomDonut(containerId) {
        const svgNS = "http://www.w3.org/2000/svg";
        const container = document.getElementById(containerId);

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        const randomX = Math.random() * containerWidth;
        const randomY = Math.random() * containerHeight + 400;

        const randomOriginX = Math.random() * 200;
        const randomOriginY = Math.random() * 400;

        const svg = document.createElementNS(svgNS, 'svg');
        svg.classList.add("donut-icon");
        svg.setAttribute('width', '100');
        svg.setAttribute('height', '100');
        svg.style.position = 'absolute';
        svg.style.left = `${randomX}px`;
        svg.style.top = `${randomY}px`;
        svg.style.transformOrigin = `${randomOriginX}% ${randomOriginY}%`;

        const randomDuration = Math.random() * 5 + 5;
        svg.style.animationDuration = `${randomDuration}s`;

        const outerCircle = document.createElementNS(svgNS, 'circle');
        outerCircle.classList.add('donut-outer-circle');
        outerCircle.setAttribute('cx', '50');
        outerCircle.setAttribute('cy', '50');
        outerCircle.setAttribute('r', '40');

        const frostingCircle = document.createElementNS(svgNS, 'circle');
        frostingCircle.classList.add('donut-frosting-circle');
        frostingCircle.setAttribute('cx', '50');
        frostingCircle.setAttribute('cy', '50');
        frostingCircle.setAttribute('r', '33');

        const innerCircle = document.createElementNS(svgNS, 'circle');
        innerCircle.classList.add('donut-inner-circle');
        innerCircle.setAttribute('cx', '50');
        innerCircle.setAttribute('cy', '50');
        innerCircle.setAttribute('r', '15');

        svg.appendChild(outerCircle);
        svg.appendChild(frostingCircle);
        svg.appendChild(innerCircle);

        // Add sprinkles
        const sprinkleCount = 20;
        const sprinkleColors = ['yellow', 'white', 'red'];
        for (let i = 0; i < sprinkleCount; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const radius = 15 + Math.random() * 18 // Between inner circle radius (20) and outer circle radius (40)
            const sprinkleX = 50 + radius * Math.cos(angle);
            const sprinkleY = 50 + radius * Math.sin(angle);

            const sprinkle = document.createElementNS(svgNS, 'circle');
            sprinkle.setAttribute('cx', sprinkleX);
            sprinkle.setAttribute('cy', sprinkleY);
            sprinkle.setAttribute('r', 2); // Small radius for sprinkles
            const randomSprinkleColor = sprinkleColors[Math.floor(Math.random() * sprinkleColors.length)];
            sprinkle.setAttribute('fill', randomSprinkleColor);
            svg.appendChild(sprinkle);
        }

        // Append SVG to the container
        container.appendChild(svg);
    }

    setHost(host) {
        this.connectHost = host;
        this.initializeWebSocket()
    }

}

(function () {
    document.documentElement.setAttribute("theme", "dark");
    const panel = new IngamePanelBATCPanel('127.0.0.1:41716');
    window.batcEfbPanel = panel;
    panel.connectedCallback();
    window.addEventListener('focus', () => panel.connect());
    window.addEventListener('beforeunload', () => panel.dispose());
})();
