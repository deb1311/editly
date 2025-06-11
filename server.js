const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { createClient } = require('@supabase/supabase-js');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'editly-renderer' });
});

// Main render endpoint
app.post('/render', async (req, res) => {
  const startTime = Date.now();
  let tempDir = null;
  
  try {
    console.log('Received render request');
    
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body required' });
    }

    // Create temporary directory for this render job
    const jobId = `render_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    tempDir = path.join('/tmp', jobId);
    await fs.mkdir(tempDir, { recursive: true });
    
    // File paths
    const specPath = path.join(tempDir, 'spec.json');
    const outputPath = path.join(tempDir, 'output.mp4');
    
    // Write the edit spec to file
    await fs.writeFile(specPath, JSON.stringify(req.body, null, 2));
    console.log(`Spec written to: ${specPath}`);
    
    // Run editly command
    console.log('Starting video render...');
    const editlyCommand = `editly "${specPath}" --out "${outputPath}"`;
    console.log(`Executing: ${editlyCommand}`);
    
    const { stdout, stderr } = await execAsync(editlyCommand, {
      cwd: tempDir,
      timeout: 300000, // 5 minute timeout
      env: {
        ...process.env,
        DISPLAY: ':99'
      }
    });
    
    if (stderr) {
      console.log('Editly stderr:', stderr);
    }
    if (stdout) {
      console.log('Editly stdout:', stdout);
    }
    
    // Check if output file was created
    try {
      await fs.access(outputPath);
      console.log('Video render completed successfully');
    } catch (error) {
      throw new Error('Output video file was not created');
    }
    
    // Get file stats
    const stats = await fs.stat(outputPath);
    console.log(`Output file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Check for Supabase upload option
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    const supabaseBucket = process.env.SUPABASE_BUCKET;
    
    if (supabaseUrl && supabaseKey && supabaseBucket) {
      try {
        console.log('Uploading to Supabase Storage...');
        
        // Initialize Supabase client
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // Read the video file
        const videoBuffer = await fs.readFile(outputPath);
        
        // Upload to Supabase Storage
        const fileName = `${jobId}.mp4`;
        const { data, error } = await supabase.storage
          .from(supabaseBucket)
          .upload(fileName, videoBuffer, {
            contentType: 'video/mp4',
            upsert: false
          });
        
        if (error) {
          console.error('Supabase upload error:', error);
          throw new Error(`Failed to upload to Supabase: ${error.message}`);
        }
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from(supabaseBucket)
          .getPublicUrl(fileName);
        
        const publicUrl = urlData.publicUrl;
        console.log(`Video uploaded successfully: ${publicUrl}`);
        
        // Clean up temp files
        await cleanup(tempDir);
        
        // Return the public URL
        return res.json({
          success: true,
          url: publicUrl,
          fileName: fileName,
          size: stats.size,
          renderTime: Date.now() - startTime
        });
        
      } catch (uploadError) {
        console.error('Upload failed, falling back to direct file response:', uploadError);
        // Fall through to direct file response
      }
    }
    
    // Direct file response (default behavior)
    console.log('Sending video file directly...');
    
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${jobId}.mp4"`);
    res.setHeader('X-Render-Time', Date.now() - startTime);
    
    // Stream the file
    const fileStream = require('fs').createReadStream(outputPath);
    fileStream.pipe(res);
    
    // Clean up after streaming
    fileStream.on('end', async () => {
      await cleanup(tempDir);
    });
    
    fileStream.on('error', async (error) => {
      console.error('File stream error:', error);
      await cleanup(tempDir);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream video file' });
      }
    });
    
  } catch (error) {
    console.error('Render error:', error);
    
    // Clean up on error
    if (tempDir) {
      await cleanup(tempDir);
    }
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Video rendering failed', 
        details: error.message,
        renderTime: Date.now() - startTime
      });
    }
  }
});

// Cleanup function
async function cleanup(tempDir) {
  try {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`Cleaned up temp directory: ${tempDir}`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Editly rendering service running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /health - Health check');
  console.log('  POST /render - Render video from Editly spec');
  
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.SUPABASE_BUCKET) {
    console.log('Supabase Storage upload enabled');
  } else {
    console.log('Supabase Storage disabled (missing environment variables)');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});
