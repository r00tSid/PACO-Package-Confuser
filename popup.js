document.addEventListener("DOMContentLoaded", () => {

    const scanBtn = document.getElementById("scan-btn");
    const saveBtn = document.getElementById("save-btn");

    const progressBar = document.getElementById("progress-bar");
    const scanStatus = document.getElementById("scan-status");

    const logContainer = document.getElementById("scan-log");
    const resultsContainer = document.getElementById("results");

    const statusIndicator = document.getElementById("status-indicator");
    const depCount = document.getElementById("dep-count");
    const riskCount = document.getElementById("risk-count");
    const selectedEcoText = document.getElementById("selected-eco");
    const targetUrl = document.getElementById("target-url");

    let lastResults = [];
    let currentTarget = "";

    function log(message) {
        logContainer.innerHTML += `> ${message}<br>`;
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    function setStatus(text) {
        statusIndicator.innerText = text;
    }

    function setEcosystem(eco) {
        const radio = document.querySelector(`input[value="${eco}"]`);
        if (radio) {
            radio.checked = true;
            selectedEcoText.innerText = eco.toUpperCase();
        }
    }

    /* ================================
       START SCAN
    ================================== */
    scanBtn.addEventListener("click", () => {

        progressBar.value = 0;
        resultsContainer.innerHTML = "";
        logContainer.innerHTML = "";
        depCount.innerText = "0";
        riskCount.innerText = "0";
        lastResults = [];

        setStatus("ACTIVE");
        scanStatus.innerText = "Detecting ecosystem...";
        log("Scan started.");

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {

            if (!tabs || !tabs.length) return;

            try {
                currentTarget = tabs[0].url;
                targetUrl.innerText = new URL(tabs[0].url).hostname;
            } catch {
                targetUrl.innerText = "Unknown";
                currentTarget = "Unknown";
            }

            chrome.tabs.sendMessage(
                tabs[0].id,
                { action: "getFileLinks" },
                (response) => {

                    if (!response || !response.files) {
                        log("No dependency files detected.");
                        setStatus("IDLE");
                        return;
                    }

                    const files = response.files;
                    const lowerUrl = currentTarget.toLowerCase();

                    /* ================================
                       SMART URL-BASED DETECTION
                    ================================== */

                    let detectedEco = null;

                    // Priority 1: Detect based on current page URL
                    if (lowerUrl.includes("gemfile")) {
                        detectedEco = "ruby";
                    }
                    else if (lowerUrl.includes("package.json")) {
                        detectedEco = "npm";
                    }
                    else if (lowerUrl.includes("requirements")) {
                        detectedEco = "python";
                    }

                    // Priority 2: Fallback to repository content
                    if (!detectedEco) {
                        if (files.ruby && files.ruby.length > 0) {
                            detectedEco = "ruby";
                        }
                        else if (files.npm && files.npm.length > 0) {
                            detectedEco = "npm";
                        }
                        else if (files.python && files.python.length > 0) {
                            detectedEco = "python";
                        }
                    }

                    if (!detectedEco) {
                        log("No supported ecosystem detected.");
                        setStatus("IDLE");
                        return;
                    }

                    setEcosystem(detectedEco);
                    log(`Detected ecosystem: ${detectedEco.toUpperCase()}`);
                    scanStatus.innerText = "Initializing scan...";

                    chrome.runtime.sendMessage({
                        action: "checkUnpublishedPackages",
                        selectedFiles: [detectedEco],
                        files: files
                    });
                }
            );
        });
    });

    /* ================================
       SAVE RESULTS
    ================================== */
    saveBtn.addEventListener("click", () => {

        if (!lastResults.length) {
            alert("No scan results to download.");
            return;
        }

        const exportData = {
            timestamp: new Date().toISOString(),
            target: currentTarget,
            ecosystem: selectedEcoText.innerText,
            totalDependencies: depCount.innerText,
            totalFindings: lastResults.length,
            findings: lastResults
        };

        const blob = new Blob(
            [JSON.stringify(exportData, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `paco-scan-${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
    });

    /* ================================
       MESSAGE LISTENER
    ================================== */
    chrome.runtime.onMessage.addListener((message) => {

        if (message.action === "updateProgress") {

            const percent = message.total === 0
                ? 0
                : Math.round((message.scanned / message.total) * 100);

            progressBar.value = percent;
            depCount.innerText = message.total;
            scanStatus.innerText =
                `Scanning ${message.scanned}/${message.total}`;

            log(`Checked ${message.scanned} dependencies...`);
        }

        if (message.action === "scanComplete") {

            setStatus("COMPLETE");
            scanStatus.innerText = "Scan complete.";
            log("Scan finished.");

            lastResults = message.results || [];

            if (!lastResults.length) {
                resultsContainer.innerHTML = "No high-risk findings.";
                return;
            }

            riskCount.innerText = lastResults.length;

            lastResults.forEach(pkg => {

                const div = document.createElement("div");
                div.classList.add("finding");

                if (pkg.status === "Unpublished") {
                    div.classList.add("high-risk");
                } else {
                    div.classList.add("medium-risk");
                }

                div.innerText =
                    `[${pkg.type.toUpperCase()}] ${pkg.name} → ${pkg.status}`;

                resultsContainer.appendChild(div);
            });
        }
    });

});
