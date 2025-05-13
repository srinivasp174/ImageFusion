import sharp from 'sharp';
import { Matrix, EigenvalueDecomposition } from 'ml-matrix';
import * as ss from 'simple-statistics';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { cosDependencies } from 'mathjs';
import { domainToASCII } from 'url';

export async function fuseImages(image1Buffer, image2Buffer, method) {
    const metadata1 = await sharp(image1Buffer).metadata();
    const metadata2 = await sharp(image2Buffer).metadata();

    const targetWidth = Math.min(metadata1.width, metadata2.width);
    const targetHeight = Math.min(metadata1.height, metadata2.height);

    const img1 = await sharp(image1Buffer)
        .resize(targetWidth, targetHeight)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const img2 = await sharp(image2Buffer)
        .resize(targetWidth, targetHeight)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { data: data1, info: info1 } = img1;
    const { data: data2 } = img2;

    const fusedData = Buffer.alloc(data1.length);

    if (method === 'laplace') {
        //Laplacian fusion
        for (let i = 0; i < data1.length; i++) {
            fusedData[i] = Math.abs(data1[i] - 128) > Math.abs(data2[i] - 128) ? data1[i] : data2[i];
        }
    }

    else if (method === 'pca') {
        const len = data1.length;
        const dataMatrix = new Matrix(len, 2);

        for (let i = 0; i < len; i++) {
            dataMatrix.set(i, 0, data1[i]);
            dataMatrix.set(i, 1, data2[i]);
        }

        const mean = dataMatrix.mean('column');
        const centered = dataMatrix.clone().subRowVector(mean);
        const covariance = centered.transpose().mmul(centered).div(len - 1);

        // Eigen decomposition using EigenvalueDecomposition
        const eigDecomp = new EigenvalueDecomposition(covariance);
        const eigValues = eigDecomp.realEigenvalues;
        const eigVectors = eigDecomp.eigenvectorMatrix;

        // Get the principal eigenvector with maximum eigenvalue
        let maxIdx = 0;
        for (let i = 1; i < eigValues.length; i++) {
            if (Math.abs(eigValues[i]) > Math.abs(eigValues[maxIdx])) {
                maxIdx = i;
            }
        }

        const principal = eigVectors.getColumn(maxIdx);

        for (let i = 0; i < len; i++) {
            const pixelVec = [data1[i] - mean[0], data2[i] - mean[1]];
            const projection = principal[0] * pixelVec[0] + principal[1] * pixelVec[1];
            fusedData[i] = Math.min(255, Math.max(0, Math.round(projection + 128)));
        }
    }

    else {
        for (let i = 0; i < data1.length; i++) {
            switch (method) {
                case 'avg':
                case 'average':
                    fusedData[i] = Math.floor((data1[i] + data2[i]) / 2);
                    break;
                case 'min':
                    fusedData[i] = Math.min(data1[i], data2[i]);
                    break;
                case 'max':
                    fusedData[i] = Math.max(data1[i], data2[i]);
                    break;
                case 'absdiff':
                    fusedData[i] = Math.abs(data1[i] - data2[i]);
                    break;
                case 'multiply':
                    fusedData[i] = Math.min(255, Math.floor((data1[i] * data2[i]) / 255));
                    break;
                case 'screen':
                    fusedData[i] = 255 - Math.floor(((255 - data1[i]) * (255 - data2[i])) / 255);
                    break;
                default:
                    fusedData[i] = Math.floor((data1[i] + data2[i]) / 2);
            }
        }
    }

    const fusedImageBuffer = await sharp(fusedData, {
        raw: {
            width: info1.width,
            height: info1.height,
            channels: 1
        }
    }).png().toBuffer();

    // Metrics Calculation
    const dataValues = Array.from(fusedData);
    const fusedMean = ss.mean(dataValues);
    const fusedVariance = ss.variance(dataValues);
    const fusedStdDev = ss.standardDeviation(dataValues);

    // Calculate skewness
    let fusedSkewness = 0;
    if (ss.skewness) {
        fusedSkewness = ss.skewness(dataValues);
    } else {
        
        const n = dataValues.length;
        const mean = fusedMean;
        const stdDev = fusedStdDev;

        let sum = 0;
        for (let i = 0; i < n; i++) {
            sum += Math.pow((dataValues[i] - mean) / stdDev, 3);
        }

        fusedSkewness = n / ((n - 1) * (n - 2)) * sum;
    }

    const metrics = {
        mean: fusedMean,
        variance: fusedVariance,
        standardDeviation: fusedStdDev,
        skewness: fusedSkewness
    };

    return { fusedImageBuffer, metrics };
}

export async function generatePDFReport(metrics, options = {}) {
    const { image1Buffer, image2Buffer, fusedImageBuffer, method, publicDir } = options;
    
    // Use the provided publicDir path or default to a relative path
    const basePath = publicDir || path.join(process.cwd(), 'public');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pdfFileName = `fusion_report_${timestamp}.pdf`;
    const pdfPath = path.join(basePath, pdfFileName);
    
    console.log(`Generating PDF at: ${pdfPath}`);

    // Create the public directory if it doesn't exist
    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
    }

    // Create temp directory for processing images if it doesn't exist
    const tempDir = path.join(basePath, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Function to convert any image buffer to PNG format for PDF compatibility
    const convertToPng = async (imageBuffer, outputPath) => {
        try {
            if (!imageBuffer) return null;
            
            await sharp(imageBuffer)
                .png()
                .toFile(outputPath);
                
            return outputPath;
        } catch (error) {
            console.error('Error converting image for PDF:', error);
            return null;
        }
    };
    
    // Convert input images to PNG format before creating the PDF
    const tempImage1Path = path.join(tempDir, `input1_${timestamp}.png`);
    const tempImage2Path = path.join(tempDir, `input2_${timestamp}.png`);
    const tempFusedPath = path.join(tempDir, `fused_${timestamp}.png`);
    
    // Convert all images to PNG in parallel
    let image1Path = null, image2Path = null, fusedPath = null;
    
    try {
        [image1Path, image2Path, fusedPath] = await Promise.all([
            image1Buffer ? convertToPng(image1Buffer, tempImage1Path) : null,
            image2Buffer ? convertToPng(image2Buffer, tempImage2Path) : null,
            fusedImageBuffer ? convertToPng(fusedImageBuffer, tempFusedPath) : null
        ]);
    } catch (error) {
        console.error('Error converting images:', error);
    }

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const stream = doc.pipe(fs.createWriteStream(pdfPath));

            // Add a title with styling
            doc.fontSize(24)
                .fillColor('#333333')
                .text('Image Fusion Report', { align: 'center' });

            doc.moveDown();

            doc.moveDown(2);

            // Add fusion method used
            if (method) {
                doc.fontSize(16).fillColor('#000000').text('Fusion Method', { underline: true });
                doc.moveDown(0.5);
                doc.fontSize(14).fillColor('#0066cc').text(method.charAt(0).toUpperCase() + method.slice(1));
                doc.moveDown(1.5);
            }

            // Add input images
            if (image1Path && image2Path) {
                doc.fontSize(16).fillColor('#000000').text('Input Images', { underline: true });
                doc.moveDown(0.5);
                
                // Calculate image dimensions to fit the page width
                const pageWidth = doc.page.width - 2 * doc.page.margins.left;
                const imageWidth = pageWidth * 0.4;
                
                // Add first image centered
                doc.fontSize(12).fillColor('#555555').text('Input Image 1:', { continued: false });
                doc.moveDown(0.3);
                doc.image(image1Path, {
                    width: imageWidth,
                    align: 'center'
                });
                doc.moveDown(1);
                
                // Add second image centered
                doc.fontSize(12).fillColor('#555555').text('Input Image 2:', { continued: false });
                doc.moveDown(0.3);
                doc.image(image2Path, {
                    width: imageWidth,
                    align: 'center'
                });
                
                doc.moveDown(1.5);
            }

            // Add fused output image
            if (fusedPath) {
                doc.fontSize(16).fillColor('#000000').text('Fused Result', { underline: true });
                doc.moveDown(0.5);
                
                // Calculate image dimensions to fit the page
                const pageWidth = doc.page.width - 2 * doc.page.margins.left;
                const imageWidth = pageWidth * 0.4;
                
                // Add the fused image centered
                doc.image(fusedPath, {
                    width: imageWidth,
                    align: 'center'
                });
                
                doc.moveDown(1.5);
            }

            // Add metrics section with better formatting
            doc.fontSize(16).fillColor('#000000').text('Fusion Metrics', { underline: true });
            doc.moveDown(0.5);

            const metrics_data = [
                { name: 'Mean', value: metrics.mean.toFixed(2) },
                { name: 'Variance', value: metrics.variance.toFixed(2) },
                { name: 'Standard Deviation', value: metrics.standardDeviation.toFixed(2) },
                { name: 'Skewness', value: metrics.skewness.toFixed(2) }
            ];

            metrics_data.forEach(item => {
                doc.fontSize(14)
                    .fillColor('#333333')
                    .text(`${item.name}: `, { continued: true })
                    .fillColor('#0066cc')
                    .text(item.value);
                doc.moveDown(0.5);
            });

            // Add a footer
            doc.moveDown(1);
            doc.fontSize(10)
                .fillColor('#999999')
                .text('Generated by Image Fusion Tool', { align: 'center' });

            doc.end();

            stream.on('finish', () => {
                console.log('PDF report generated successfully.');
                
                // Return the full absolute path
                resolve(pdfPath);
                
                //clean up temp files after PDF is generated
                setTimeout(() => {
                    [image1Path, image2Path, fusedPath].forEach(filePath => {
                        if (filePath && fs.existsSync(filePath)) {
                            fs.unlink(filePath, err => {
                                if (err) console.error(`Error deleting temp file ${filePath}:`, err);
                            });
                        }
                    });
                }, 5000); // Give some time before cleanup
            });
            
            stream.on('error', (error) => {
                console.error('Stream error generating PDF:', error);
                reject(error);
            });
            
        } catch (error) {
            console.error('Error generating PDF:', error);
            reject(error);
        }
    });
}