"""
Local Web Server & Browser Launcher for OS RAG Simulator.
Serves the web application on localhost:8000 and automatically launches the browser.
"""

import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def main():
    os.chdir(DIRECTORY)
    url = f"http://localhost:{PORT}/index.html"
    print("=" * 70)
    print("  OS RESOURCE ALLOCATION GRAPH (RAG) SIMULATOR WEB SERVER")
    print("=" * 70)
    print(f"Serving files from: {DIRECTORY}")
    print(f"Opening browser at: {url}")
    print("Press Ctrl+C to stop the server.\n")

    webbrowser.open(url)

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server. Goodbye!")

if __name__ == "__main__":
    main()
