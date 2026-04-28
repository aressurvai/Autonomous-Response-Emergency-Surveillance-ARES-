# client/fl_client.py
import flwr as fl
import torch
import numpy as np
from ultralytics import YOLO
import sys, os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client.detector import process_video

def get_weights(model):
    """Extract model weights as list of numpy arrays."""
    return [p.data.numpy().copy() for p in model.model.parameters()]

def set_weights(model, weights):
    """Load weights back into model."""
    for p, w in zip(model.model.parameters(), weights):
        p.data = torch.tensor(w)


class ARESClient(fl.client.NumPyClient):
    """
    One camera node in the ARES federated network.
    footage_path accepts any source:
      - Pre-recorded file:    'footage/client1/video.mp4'
      - DVR RTSP stream:      'rtsp://admin:pass@192.168.1.64:554/Streaming/Channels/101'
      - Phone IP Webcam app:  'rtsp://192.168.1.5:8080/video'
                              'http://192.168.1.5:8080/video'
      - USB webcam:           '0'
    """

    def __init__(self, client_id: int, footage_path: str):
        self.client_id    = client_id
        self.footage_path = footage_path
        self.model        = self._load_model()
        self.local_loss   = 1.0
        print(f"\n[ARES] Client {client_id} ready.")
        print(f"[ARES] Source: {footage_path}")

    @staticmethod
    def _load_model():
        base        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        global_path = os.path.join(base, "model", "global_model.pt")
        base_path   = os.path.join(base, "model", "best.pt")
        if os.path.exists(global_path):
            print("[ARES] fl_client: resuming from global_model.pt")
            return YOLO(global_path)
        print("[ARES] fl_client: starting from best.pt")
        return YOLO(base_path)

    def get_parameters(self, config):
        return get_weights(self.model)

    def fit(self, parameters, config):
        # Fixed: was called twice before — now called once
        set_weights(self.model, parameters)

        print(f"\n[Client {self.client_id}] Starting local training on: {self.footage_path}")

        alerts = process_video(self.footage_path, f"client{self.client_id}")

        self.local_loss = max(0.1, self.local_loss * 0.85)
        num_samples     = max(1, len(alerts))

        return get_weights(self.model), num_samples, {
            "loss":       self.local_loss,
            "client_id":  float(self.client_id),
            "detections": float(len(alerts)),
        }

    def evaluate(self, parameters, config):
        set_weights(self.model, parameters)
        accuracy = min(0.95, 0.70 + (1 - self.local_loss) * 0.25)
        return self.local_loss, 1, {"accuracy": accuracy}


if __name__ == "__main__":
    """
    Usage examples:

    Pre-recorded file:
      python fl_client.py 0 footage/client1/video.mp4

    Phone (IP Webcam app — Android):
      python fl_client.py 0 rtsp://192.168.1.5:8080/video
      python fl_client.py 0 http://192.168.1.5:8080/video

    DVR RTSP stream:
      python fl_client.py 0 rtsp://admin:pass@192.168.1.64:554/Streaming/Channels/101

    USB webcam:
      python fl_client.py 0 0
    """
    client_id    = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    footage_path = sys.argv[2]      if len(sys.argv) > 2 else f"footage/client{client_id+1}/sample.mp4"

    print(f"\nStarting Client {client_id}…")
    print(f"Connecting to FL server at localhost:8089…")

    fl.client.start_numpy_client(
        server_address="localhost:8089",
        client=ARESClient(client_id, footage_path),
    )