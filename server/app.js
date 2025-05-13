import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fuseImages, generatePDFReport } from './fusion.js';

// Setup ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Add this to your existing Express setup to ensure PDFs are served correctly
app.use('/public', express.static('public'));

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// Create images directory if it doesn't exist
const imagesDir = path.join(publicDir, 'images');
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir);
}

// Setup multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// GET route to list available images
app.get('/images/list', (req, res) => {
    try {
        const files = fs.readdirSync(imagesDir);
        const images = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        });
        res.json(images);
    } catch (error) {
        console.error('Error listing images:', error);
        res.status(500).json({ error: 'Failed to list images' });
    }
});

// Serve individual images
app.get('/images/:filename', (req, res) => {
    const filename = req.params.filename;
    const imagePath = path.join(imagesDir, filename);
    
    if (fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).json({ error: 'Image not found' });
    }
});

// POST route for image fusion (with file uploads)
app.post('/api/fuse', upload.fields([
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.image1 || !req.files.image2) {
            return res.status(400).json({ error: 'Missing image files' });
        }

        const image1 = req.files.image1[0].buffer;
        const image2 = req.files.image2[0].buffer;
        const method = req.body.method || 'average';
        const generatePdf = req.body.generatePdf === 'true';

        // Perform fusion
        const { fusedImageBuffer, metrics } = await fuseImages(image1, image2, method);

        // Save the fused image
        const fusedImagePath = path.join(publicDir, 'fused.png');
        fs.writeFileSync(fusedImagePath, fusedImageBuffer);

        let pdfUrl = null;
        
        // Generate PDF report if requested
        if (generatePdf) {
            pdfUrl = await generatePDFReport(metrics);
        }

        res.json({
            message: 'Fusion successful',
            imageUrl: '/fused.png',
            metrics,
            pdfUrl
        });

    } catch (error) {
        console.error('Fusion error:', error);
        res.status(500).json({ error: 'Fusion failed', message: error.message });
    }
});

// GET route to retrieve metrics for images
app.get('/metrics', async (req, res) => {
    try {
        const { image1, image2, method = 'average' } = req.query;
        
        if (!image1 || !image2) {
            return res.status(400).json({ error: 'Missing image names' });
        }

        // Read image files
        const image1Path = path.join(imagesDir, image1);
        const image2Path = path.join(imagesDir, image2);
        
        if (!fs.existsSync(image1Path) || !fs.existsSync(image2Path)) {
            return res.status(404).json({ error: 'One or more images not found' });
        }
        
        const image1Buffer = fs.readFileSync(image1Path);
        const image2Buffer = fs.readFileSync(image2Path);
        
        // Perform fusion and get metrics
        const { metrics } = await fuseImages(image1Buffer, image2Buffer, method);
        
        // Return just the metrics
        res.json(metrics);
        
    } catch (error) {
        console.error('Metrics error:', error);
        res.status(500).json({ error: 'Failed to calculate metrics', message: error.message });
    }
});

// Update the /fuse endpoint to store the images for PDF generation
app.post('/fuse', express.json(), async (req, res) => {
    try {
        const { image1Name, image2Name, method = 'average' } = req.body;

        console.log('Request Body:', req.body);

        if (!image1Name || !image2Name) {
            console.error('Missing image names');
            return res.status(400).json({ error: 'Missing image names' });
        }

        const image1Path = path.join(imagesDir, image1Name);
        const image2Path = path.join(imagesDir, image2Name);

        if (!fs.existsSync(image1Path) || !fs.existsSync(image2Path)) {
            console.error('One or more images not found');
            return res.status(404).json({ error: 'One or more images not found' });
        }

        const image1Buffer = fs.readFileSync(image1Path);
        const image2Buffer = fs.readFileSync(image2Path);

        const { fusedImageBuffer, metrics } = await fuseImages(image1Buffer, image2Buffer, method);

        // Store these for PDF generation
        // Use session storage or a temporary store in a real application
        app.locals.lastFusion = {
            image1Buffer,
            image2Buffer,
            fusedImageBuffer,
            method,
            metrics,
            image1Name,
            image2Name
        };

        res.json({
            fusedImage: `data:image/png;base64,${fusedImageBuffer.toString('base64')}`,
            metrics
        });
    } catch (error) {
        console.error('Fusion error:', error);
        res.status(500).json({ error: 'Fusion failed', message: error.message });
    }
});

// Update the /generate-pdf endpoint to use the stored image data
app.post('/generate-pdf', express.json(), async (req, res) => {
    try {
        // Get the fusion data from our app storage
        const lastFusion = app.locals.lastFusion;
        
        if (!lastFusion) {
            return res.status(400).json({ error: 'No fusion data available. Please perform a fusion first.' });
        }
        
        // Generate PDF report with all data
        const pdfUrl = await generatePDFReport(lastFusion.metrics, {
            image1Buffer: lastFusion.image1Buffer,
            image2Buffer: lastFusion.image2Buffer,
            fusedImageBuffer: lastFusion.fusedImageBuffer,
            method: lastFusion.method,
            image1Name: lastFusion.image1Name,
            image2Name: lastFusion.image2Name
        });
        
        res.json({ pdfUrl });
    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({ error: 'Failed to generate PDF', message: error.message });
    }
});

// Add this route to handle direct PDF downloads with proper headers
app.get('/public/:filename', (req, res) => {
    const filename = req.params.filename;
    // Only allow PDF files through this route for security
    if (filename.endsWith('.pdf')) {
        const filePath = path.join(__dirname, '..', 'public', filename);
        
        if (fs.existsSync(filePath)) {
            // Set headers to force download
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/pdf');
            res.sendFile(filePath);
        } else {
            res.status(404).send('File not found');
        }
    } else {
        res.status(403).send('Access denied');
    }
});

// NEW GET ROUTE: Directly download PDF with query parameters
app.get('/download-pdf', async (req, res) => {
    try {
        const { image1, image2, method, mean, variance, stddev, skewness, id } = req.query;
        
        if (!image1 || !image2 || !method || !mean || !variance || !stddev || !skewness) {
            return res.status(400).send('Missing required parameters');
        }
        
        // Load images
        const image1Path = path.join(imagesDir, image1);
        const image2Path = path.join(imagesDir, image2);
        
        if (!fs.existsSync(image1Path) || !fs.existsSync(image2Path)) {
            return res.status(404).send('One or more images not found');
        }
        
        const image1Buffer = fs.readFileSync(image1Path);
        const image2Buffer = fs.readFileSync(image2Path);
        
        // Get fused image if available
        let fusedImageBuffer;
        if (app.locals.lastFusion && app.locals.lastFusion.fusedImageBuffer) {
            fusedImageBuffer = app.locals.lastFusion.fusedImageBuffer;
        }
        
        // Create metrics object from query params
        const metrics = {
            mean: parseFloat(mean),
            variance: parseFloat(variance),
            standardDeviation: parseFloat(stddev),
            skewness: parseFloat(skewness)
        };
        
        // Generate the PDF - specifying the full absolute path to ensure consistency
        const pdfPath = await generatePDFReport(metrics, { 
            method,
            image1Buffer,
            image2Buffer,
            fusedImageBuffer,
            publicDir: publicDir
        });
        
        console.log(`Sending PDF file from: ${pdfPath}`);
        
        // Check if file exists
        if (!fs.existsSync(pdfPath)) {
            console.error(`PDF file not found at path: ${pdfPath}`);
            return res.status(404).send(`PDF file not found`);
        }
        
        // Read the file into memory to prevent timeout issues
        const pdfData = fs.readFileSync(pdfPath);
        
        // Set headers to force download with a more friendly filename
        const timestamp = new Date().toISOString().split('T')[0];
        const downloadFilename = `fusion_report_${method}_${timestamp}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
        res.setHeader('Content-Length', pdfData.length);
        res.setHeader('Cache-Control', 'no-cache');
        
        // Send the PDF data directly instead of using sendFile
        res.end(pdfData);
        
    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).send('Failed to generate PDF: ' + error.message);
    }
});

// Default route
app.get('/', (req, res) => {
    res.send('Image Fusion API is running.');
});

app.listen(PORT, () => {
    console.log(`Server listening at http://localhost:${PORT}`);
});