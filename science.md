# Theory

Image fusion is the process of combining information from two or more source images of the same scene to produce a single composite image that contains more complete and accurate information than any of the individual source images. The goal is to retain the most salient features from each source image while minimizing redundancy and noise.

## Methods used

1. **Average**: Computes the arithmetic mean of corresponding pixels.  
   ```F(x,y) = [I₁(x,y) + I₂(x,y)] / 2```

2. **Maximum**: Selects the pixel with the highest intensity value.  
   ``` F(x,y) = max[I₁(x,y), I₂(x,y)] ```

3. **Minimum**: Selects the pixel with the lowest intensity value.  
   ``` F(x,y) = min[I₁(x,y), I₂(x,y)] ```

4. **Absolute Difference**: Calculates the absolute difference between corresponding pixels.  
   ``` F(x,y) = |I₁(x,y) - I₂(x,y)| ```

5. **Multiply**: Multiplies the pixel values and scales the result, darkening the image while preserving highlights where both images are bright.  
   ``` F(x,y) = (I₁(x,y) × I₂(x,y)) ÷ 255 ```

6. **Screen**: Inverts, multiplies, then inverts again, creating a lightening effect.  
   ``` F(x,y) = 255 - ((255 - I₁(x,y)) × (255 - I₂(x,y)) ÷ 255) ```

7. **Laplacian**: Preserves edge details by selecting pixels from the image with stronger edge responses. This method detects which image has more detail at each pixel by measuring how far each pixel is from the mid-gray value (128).  
   ``` F(x,y) = I₁(x,y) if |I₁(x,y) - 128| > |I₂(x,y) - 128|, otherwise I₂(x,y) ```

8. **Principal Component Analysis (PCA)**: This method transforms the source images into a new coordinate system where the first component contains the maximum variance. It identifies the most important patterns in the data and uses them to create the fused image.

## Performance Metrics

The quality of image fusion is measured using statistical metrics:

1. **Mean**: Average brightness of the fused image.
   ```μ = (1/N) · Σ F(x,y)```

2. **Variance**: How spread out the pixel values are. A higher variance indicates more information content in the image.
   ```σ² = (1/N) · Σ [F(x,y) - μ]²```

3. **Standard Deviation**: Measure of image contrast. Higher standard deviation generally means better contrast in the fused image.
   ```σ = √((1/N) · Σ [F(x,y) - μ]²)```

4. **Skewness**: Indicates whether the image is more weighted toward dark or light pixels. Positive skewness indicates more bright areas, negative skewness indicates more dark areas.
   ```[(1/N) · Σ (F(x,y) - μ)³] / σ³```
