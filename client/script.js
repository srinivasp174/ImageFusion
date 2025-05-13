const image1Select = document.getElementById('image1Select');
const image2Select = document.getElementById('image2Select');
const fusionForm = document.getElementById('fusionForm');
const resultDiv = document.getElementById('result');
const preview1 = document.getElementById('preview1');
const preview2 = document.getElementById('preview2');
const fusedPreview = document.getElementById('fusedPreview');
const methodSelect = document.getElementById('methodSelect');
const generatePdfCheckbox = document.getElementById('generatePdf');
const metricsContainer = document.getElementById('metricsContainer');
const downloadMetricsButton = document.getElementById('downloadMetrics');

const BASE_URL = 'http://localhost:3000';

async function loadImages() {
    // Clear existing options
    image1Select.innerHTML = '<option>Loading...</option>';
    image2Select.innerHTML = '<option>Loading...</option>';
    
    try {
        const response = await fetch(`${BASE_URL}/images/list`);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch image list: ${response.statusText}`);
        }
        
        const images = await response.json();

        if (!images.length) {
            displaySelectError('No images available');
            return;
        }

        // Enable selects and clear placeholders
        image1Select.disabled = false;
        image2Select.disabled = false;
        image1Select.innerHTML = '';
        image2Select.innerHTML = '';

        // Populate select dropdowns with available images
        images.forEach(image => {
            const option1 = new Option(image, image);
            const option2 = new Option(image, image);
            image1Select.appendChild(option1);
            image2Select.appendChild(option2);
        });

        // Set defaults and preview
        image1Select.value = images[0];
        image2Select.value = images.length > 1 ? images[1] : images[0];
        
        // Initialize image previews
        previewImage(image1Select, preview1);
        previewImage(image2Select, preview2);

    } catch (err) {
        console.error('Error loading images', err);
        displaySelectError('Failed to fetch image list');
    }
}

function displaySelectError(message) {
    const opt = new Option(message, '');
    image1Select.innerHTML = '';
    image2Select.innerHTML = '';
    image1Select.appendChild(opt.cloneNode(true));
    image2Select.appendChild(opt.cloneNode(true));
    image1Select.disabled = true;
    image2Select.disabled = true;
}

function previewImage(selectEl, previewEl) {
    const filename = selectEl.value;
    if (filename) {
        previewEl.src = `${BASE_URL}/images/${filename}`;
        previewEl.style.display = 'block';
    } else {
        previewEl.style.display = 'none';
    }
}

image1Select.addEventListener('change', () => {
    previewImage(image1Select, preview1);
    normalizeImageSizes();
});
image2Select.addEventListener('change', () => {
    previewImage(image2Select, preview2);
    normalizeImageSizes();
});

fusionForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const image1 = image1Select.value;
    const image2 = image2Select.value;
    const method = methodSelect.value;

    // Show a loading message
    fusedPreview.style.display = 'none';
    metricsContainer.style.display = 'none';
    downloadMetricsButton.style.display = 'none';
    metricsContainer.innerHTML = 'Processing...';

    try {
        const response = await fetch('http://localhost:3000/fuse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image1Name: image1, 
                image2Name: image2, 
                method: method
            })
        });

        if (response.ok) {
            const data = await response.json();

            // Show the fused image
            fusedPreview.src = data.fusedImage;
            fusedPreview.style.display = 'block';

            // Add this line to normalize sizes after setting the image
            normalizeImageSizes();

            // Show the metrics
            const metrics = data.metrics;
            metricsContainer.innerHTML = `
                <p><strong>Mean:</strong> ${metrics.mean.toFixed(2)}</p>
                <p><strong>Variance:</strong> ${metrics.variance.toFixed(2)}</p>
                <p><strong>Standard Deviation:</strong> ${metrics.standardDeviation.toFixed(2)}</p>
                <p><strong>Skewness:</strong> ${metrics.skewness.toFixed(2)}</p>
            `;
            metricsContainer.style.display = 'block';

            // Enable the download metrics button
            downloadMetricsButton.style.display = 'inline-block';
            downloadMetricsButton.textContent = 'Download Report'; // Updated text
            downloadMetricsButton.classList.add('btn-primary');
            downloadMetricsButton.classList.remove('btn-outline-primary');
            
            // Store the method for the report
            downloadMetricsButton.setAttribute('data-method', methodSelect.value);
            
            downloadMetricsButton.onclick = () => downloadPDF(metrics);
        } else {
            metricsContainer.innerHTML = '<p class="text-danger">Fusion failed</p>';
        }
    } catch (error) {
        console.error('Error during fusion:', error);
        metricsContainer.innerHTML = '<p class="text-danger">An error occurred</p>';
    }
});

function downloadPDF(metrics) {
    // Show loading state
    downloadMetricsButton.disabled = true;
    downloadMetricsButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Generating...';
    
    // Get the currently selected images and method
    const image1 = image1Select.value;
    const image2 = image2Select.value;
    const method = methodSelect.value;
    
    // Generate a unique ID for the report
    const reportId = Date.now();
    
    // Create a direct download link with query parameters
    const downloadUrl = `${BASE_URL}/download-pdf?` + 
        `image1=${encodeURIComponent(image1)}` +
        `&image2=${encodeURIComponent(image2)}` +
        `&method=${encodeURIComponent(method)}` +
        `&mean=${encodeURIComponent(metrics.mean)}` +
        `&variance=${encodeURIComponent(metrics.variance)}` +
        `&stddev=${encodeURIComponent(metrics.standardDeviation)}` +
        `&skewness=${encodeURIComponent(metrics.skewness)}` +
        `&id=${reportId}`;
    
    // Use Fetch API with blob handling
    fetch(downloadUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.blob();
        })
        .then(blob => {
            // Create object URL for the blob
            const url = window.URL.createObjectURL(blob);
            
            // Create temporary anchor element for download
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            
            // Generate filename
            const timestamp = new Date().toISOString().split('T')[0];
            a.download = `fusion_report_${method}_${timestamp}.pdf`;
            
            // Add to document, trigger click and remove
            document.body.appendChild(a);
            a.click();
            
            // Clean up
            setTimeout(() => {
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                // Reset button state
                downloadMetricsButton.disabled = false;
                downloadMetricsButton.innerHTML = 'Download Report';
            }, 100);
        })
        .catch(error => {
            console.error('Download failed:', error);
            downloadMetricsButton.disabled = false;
            downloadMetricsButton.innerHTML = 'Try Again';
            
            // Show error to user
            alert('Failed to download report: ' + error.message);
        });
        
    // Make sure to prevent default button behavior
    return false;
}

// Make sure the event handler properly prevents form submission
if (downloadMetricsButton) {
    downloadMetricsButton.addEventListener('click', function(event) {
        // Ensure we prevent default action
        event.preventDefault();
        
        // Get metrics from the metrics container
        const metrics = {
            mean: parseFloat(document.querySelector('p:nth-child(1)').textContent.split(':')[1].trim()),
            variance: parseFloat(document.querySelector('p:nth-child(2)').textContent.split(':')[1].trim()),
            standardDeviation: parseFloat(document.querySelector('p:nth-child(3)').textContent.split(':')[1].trim()),
            skewness: parseFloat(document.querySelector('p:nth-child(4)').textContent.split(':')[1].trim())
        };
        
        downloadPDF(metrics);
        return false;
    });
}

// Ensure all images have the same dimensions
function normalizeImageSizes() {
    // Get all images
    const images = document.querySelectorAll('.preview-img, .fused-img');
    
    // Apply consistent size and styling
    images.forEach(img => {
        // Ensure visible (needed for fused image)
        if (img.src) {
            img.style.display = 'block';
        }
    });
}

// Also call it on initial load
window.addEventListener('load', normalizeImageSizes);

// Initialize on load
loadImages();