chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action !== "checkUnpublishedPackages") return;

    const { selectedFiles, files } = request;

    let results = [];
    let seenPackages = new Set();
    let seenResults = new Set();

    let totalDependencies = 0;
    let scannedDependencies = 0;

    const maxConcurrentRequests = 40;
    let activeRequests = 0;
    let packageQueue = [];

    const safeSendMessage = (message) => {
        chrome.runtime.sendMessage(message, () => chrome.runtime.lastError);
    };

    /* ================================
       REGISTRY CHECK
    ================================== */
    const fetchStatus = async (url, packageName, type, sourceFile) => {

        activeRequests++;

        try {
            const response = await fetch(url, { cache: "no-store" });

            let status = "Published";

            if (response.status === 404) {
                status = "Not Found";
            }

            if (type === "npm" && response.status === 200) {
                const data = await response.json();
                if (data?.time?.unpublished) {
                    status = "Unpublished";
                }
            }

            if (status !== "Published") {

                const resultKey = `${type}:${packageName}:${status}`;


                if (!seenResults.has(resultKey)) {
                    seenResults.add(resultKey);
                    results.push({
                        name: packageName,
                        type,
                        status,
                        sourceFile
                    });
                }
            }

        } catch (error) {
            console.error(`Registry check failed for ${packageName}:`, error);
        }

        scannedDependencies++;
        activeRequests--;

        safeSendMessage({
            action: "updateProgress",
            scanned: scannedDependencies,
            total: totalDependencies
        });

        processQueue();
    };

    /* ================================
       SAFE QUEUE PROCESSOR
    ================================== */
    const processQueue = () => {

        while (activeRequests < maxConcurrentRequests) {

            const nextItem = packageQueue.shift();
            if (!nextItem) break;

            fetchStatus(
                nextItem.url,
                nextItem.name,
                nextItem.type,
                nextItem.sourceFile
            );
        }
    };

    /* ================================
       DEPENDENCY EXTRACTION
    ================================== */
    const extractDependencies = async (file, type) => {

        try {
            const response = await fetch(file.url);
            if (!response.ok) throw new Error(`Failed to fetch ${file.url}`);

            const text = await response.text();
            let dependencies = [];

            if (type === "npm") {
                const json = JSON.parse(text);
                const deps = json.dependencies || {};
                const devDeps = json.devDependencies || {};
                dependencies = Object.keys({ ...deps, ...devDeps });
            }

            else if (type === "ruby") {
                dependencies = [...text.matchAll(/gem ["']([^"']+)["']/g)]
                    .map(m => m[1]);
            }

            else if (type === "python") {
                dependencies = [...new Set(
                    text
                        .split("\n")
                        .map(line => line.trim())
                        .filter(line =>
                            line &&
                            !line.startsWith("#") &&
                            !line.startsWith("--") &&
                            !line.startsWith("git+") &&
                            !line.startsWith("-e")
                        )
                        .map(line => {
                            const match = line.match(/^[a-zA-Z0-9._-]+/);
                            return match ? match[0] : null;
                        })
                        .filter(Boolean)
                )];
            }

            dependencies.forEach(name => {

                const uniqueKey = `${type}:${name}`;


                if (!seenPackages.has(uniqueKey)) {

                    seenPackages.add(uniqueKey);

                    const url =
                        type === "npm"
                            ? `https://registry.npmjs.org/${name}`
                            : type === "ruby"
                                ? `https://rubygems.org/gems/${name}`
                                : `https://pypi.org/pypi/${name}/json`;

                    packageQueue.push({
                        url,
                        name,
                        type,
                        sourceFile: file.url
                    });

                    totalDependencies++;
                }
            });

        } catch (error) {
            console.error("Dependency extraction error:", error);
        }
    };

    /* ================================
       MAIN EXECUTION
    ================================== */
    (async () => {

        for (const type of selectedFiles) {

            if (!files[type] || files[type].length === 0) continue;

            for (const file of files[type]) {
                await extractDependencies(file, type);
            }
        }

        if (totalDependencies === 0) {

            safeSendMessage({
                action: "scanComplete",
                results: []
            });

            sendResponse({ results: [] });
            return;
        }

        processQueue();

        const interval = setInterval(() => {

            if (activeRequests === 0 && packageQueue.length === 0) {

                clearInterval(interval);

                safeSendMessage({
                    action: "scanComplete",
                    results
                });

                sendResponse({ results });
            }

        }, 200);

    })();

    return true;
});
