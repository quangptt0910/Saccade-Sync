// ============================================================================
// SIMPLE TOP NAVIGATION BAR COMPONENT
// ============================================================================

class TopBar {
    constructor(currentPage = 'home') {
        this.currentPage = currentPage;
        this.render();
    }

    render() {
        const topBarHTML = `
            <nav class="topbar">
                <div class="topbar-logo">
                    <a href="index.html">Iris Tracker</a>
                </div>
                
                <ul class="topbar-nav">
                    <li><a href="index.html" class="${this.currentPage === 'home' ? 'active' : ''}">Home</a></li>
                    <li><a href="screens/survey/survey.html" class="${this.currentPage === 'survey' ? 'active' : ''}">Survey</a></li>
                    <li><a href="screens/calibration/calibration.html" class="${this.currentPage === 'calibration' ? 'active' : ''}">Calibration</a></li>
                    <li><a href="screens/game/game.html" class="${this.currentPage === 'game' ? 'active' : ''}">Game</a></li>
                    <li><a href="results.html" class="${this.currentPage === 'results' ? 'active' : ''}">Results</a></li>
                    <li><a href="settings.html" class="${this.currentPage === 'settings' ? 'active' : ''}">Settings</a></li>
                    <li><a href="screens/login/login.html" class="${this.currentPage === 'login' ? 'active' : ''}">Login</a></li>
                </ul>
                
                <button class="topbar-toggle" id="topbarToggle">☰</button>
            </nav>
        `;

        document.body.insertAdjacentHTML('afterbegin', topBarHTML);
        this.setupMobileMenu();
    }

    setupMobileMenu() {
        const toggle = document.getElementById('topbarToggle');
        const nav = document.querySelector('.topbar-nav');

        if (toggle && nav) {
            toggle.addEventListener('click', () => {
                nav.classList.toggle('active');
            });
        }
    }
}

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    const currentPage = document.body.dataset.page || 'home';
    new TopBar(currentPage);
});
