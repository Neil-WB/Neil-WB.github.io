// DOM elements
const header = document.querySelector('.mobile-header');
const progressBar = document.querySelector('.progress-bar');
const showHeaderThreshold = 100;

// Throttle function to limit the frequency of function calls
const throttle = (func, limit) => {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

// Update progress bar and header visibility
const updateProgressBar = () => {
    const scrollPercentage = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
    progressBar.style.width = `${scrollPercentage}%`;
    header.style.transform = `translateY(${window.scrollY > showHeaderThreshold ? '0' : '-100%'})`;
};

// Generate table of contents
const generateTOC = () => {
    const tocContainer = document.querySelector('.auto-toc');
    if (!tocContainer) return;

    const headers = document.querySelectorAll('h2, h3, h4, h5, h6');
    if (headers.length === 0) return;

    const toc = document.createElement('nav');
    toc.className = 'toc-nav';
    const tocList = document.createElement('ul');

    headers.forEach((header, index) => {
        if (!header.id) {
            header.id = `toc-header-${index}`;
        }

        const listItem = document.createElement('li');
        const link = document.createElement('a');
        link.textContent = header.textContent;
        link.href = `#${header.id}`;
        
        listItem.className = `toc-item toc-${header.tagName.toLowerCase()}`;

        link.addEventListener('click', (e) => {
            e.preventDefault();
            header.scrollIntoView({ behavior: 'smooth' });
        });

        listItem.appendChild(link);
        tocList.appendChild(listItem);
    });

    toc.appendChild(tocList);
    tocContainer.appendChild(toc);
};

// Add click-to-copy functionality for headings
const addHeadingClickToCopy = () => {
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => {
        heading.innerHTML = `<span class="heading-container">${heading.innerHTML}</span>`;
        heading.addEventListener('click', () => {
            const pageUrl = window.location.href.split('#')[0];
            const headingLink = `${pageUrl}#${heading.id}`;
            navigator.clipboard.writeText(headingLink).then(() => {
                console.log('Link copied to clipboard:', headingLink);
                // Add visual feedback
                const feedback = document.createElement('span');
                feedback.textContent = 'Link copied!';
                feedback.className = 'copy-feedback';
                heading.appendChild(feedback);
                setTimeout(() => feedback.remove(), 2000);
            }).catch(err => {
                console.error('Failed to copy link:', err);
            });
        });
    });
};

// Initialize everything when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('scroll', throttle(updateProgressBar, 100));
    updateProgressBar(); // Initial call
    generateTOC();
    addHeadingClickToCopy();
});
  
