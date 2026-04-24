# api/test_upload.py
import requests

with open('../footage/client1/footage1.mp4', 'rb') as f:
    response = requests.post(
        'http://localhost:8000/upload-video/client1',
        files={'file': ('footage1.mp4', f, 'video/mp4')}
    )
    print(response.json())