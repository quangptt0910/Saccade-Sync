# SaccadeSync - Iris & Pupil Tracking (Local Demo)

Web application uses standard front-facing camera to track and analyze saccadic eye movements by monitoring iris and pupil positions in real-time. Built with MediaPipe Face Mesh, it runs entirely on the client-side without any server or build process.
## Features

- **Real-Time Tracking**: Uses your webcam to track iris and pupil positions in real-time.
- **Data Display**: Shows the X/Y coordinates of the left and right pupils, plus their approximate radius.
- **Performance Metrics**: Displays the current FPS and total frames processed.
- **Data Export**: Allows you to export the recorded tracking data to a CSV file for analysis.
- **Simple & Local**: Runs entirely on the client-side. No server or build process required.

## How to Run

1.  **Install a npm module**:
    ```bash
    npm install 
    ```

2.  **Start the server**:
    In the project directory, run:
    ```bash
    npm start
    ```

3.  **Open in your browser**:
    Navigate to the local URL provided by the server (usually `http://localhost:3000`).

## How It Works

- **HTML/CSS/JS**: A standard, no-framework setup.
- **MediaPipe Face Mesh**: Loaded via a CDN. The model is configured to refine landmarks, which enables detailed tracking of the eyes and irises.
- **Canvas API**: Used to draw the video feed and the tracking landmarks (pupil centers and iris outlines).
- **WebRTC (`getUserMedia`)**: To access the webcam feed.

## Files

- `index.html`: The main page structure, including all UI elements and CDN links for MediaPipe.
- `app.js`: The core logic for initializing MediaPipe, managing the camera, processing tracking results, and handling UI interactions.
- `styles.css`: Basic styling for the application.
- `package.json`: Project metadata (no dependencies for this simple version).

