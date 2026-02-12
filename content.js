async function getRepoLinks() {
    const repoLinks = new Set();
    const currentUrl = window.location.href;

    /* ================================
       SEARCH PAGE (Repo + Code)
    ================================== */
    if (currentUrl.includes("github.com/search")) {

        document.querySelectorAll('a[href]').forEach(link => {

            const href = link.getAttribute("href");
            if (!href) return;

            // Case 1: Repository search result
            if (/^\/[^\/]+\/[^\/]+$/.test(href)) {
                repoLinks.add(`https://github.com${href}`);
            }

            // Case 2: Code search result (blob links)
            const blobMatch = href.match(/^\/([^\/]+\/[^\/]+)\/blob\//);
            if (blobMatch) {
                repoLinks.add(`https://github.com/${blobMatch[1]}`);
            }
        });

        return [...repoLinks];
    }

    /* ================================
       DIRECT REPO PAGE
    ================================== */
    const repoMatch = currentUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+/);

    if (repoMatch) {
        repoLinks.add(repoMatch[0]);
    }

    return [...repoLinks];
}

async function getPackageLinksFromRepo(repoUrl) {

    let fileLinks = { npm: [], ruby: [], python: [] };
    let seenFiles = new Set();

    try {
        const response = await fetch(repoUrl);
        if (!response.ok) throw new Error("Failed to fetch repo page");

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        doc.querySelectorAll('a[href]').forEach(link => {

            const href = link.getAttribute("href");
            if (!href || !href.includes("/blob/")) return;

            const rawUrl =
                `https://github.com${href.replace("/blob/", "/raw/")}`;

            if (seenFiles.has(rawUrl)) return;
            seenFiles.add(rawUrl);

            if (href.endsWith("package.json")) {
                fileLinks.npm.push({ url: rawUrl });
            }

            else if (/Gemfile(\..*)?$/.test(href)) {
                fileLinks.ruby.push({ url: rawUrl });
            }

            else if (/requirements(\..*)?\.txt$/.test(href)) {
                fileLinks.python.push({ url: rawUrl });
            }
        });

    } catch (error) {
        console.error(`Failed to fetch repo ${repoUrl}:`, error);
    }

    return fileLinks;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action !== "getFileLinks") return;

    getRepoLinks().then(async (repos) => {

        if (!repos || repos.length === 0) {
            sendResponse({ files: { npm: [], ruby: [], python: [] } });
            return;
        }

        let allFiles = { npm: [], ruby: [], python: [] };

        for (const repo of repos) {
            const repoFiles = await getPackageLinksFromRepo(repo);

            Object.keys(allFiles).forEach(type => {
                allFiles[type].push(...repoFiles[type]);
            });
        }

        sendResponse({ files: allFiles });
    });

    return true;
});
