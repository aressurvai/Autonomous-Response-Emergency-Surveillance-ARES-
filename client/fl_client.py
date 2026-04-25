# client/fl_client.py
import flwr as fl
import torch
import numpy as np
from ultralytics import YOLO
import sys, os

# Add parent directory to path so we can import detector
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
    One simulated camera node.
    Each client has its own video footage (local private data).
    """
    
    def __init__(self, client_id: int, footage_path: str):
        self.client_id    = client_id
        self.footage_path = footage_path
        self.model        = self._load_model()          # ← changed
        self.model_type   = "yolov8s"
        self.local_loss   = 1.0
        print(f"Client {client_id} ready. Footage: {footage_path}")

    @staticmethod
    def _load_model():
        """Load global_model.pt if it exists, otherwise fall back to best.pt."""
        base        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        global_path = os.path.join(base, "model", "global_model.pt")
        base_path   = os.path.join(base, "model", "best.pt")
        if os.path.exists(global_path):
            print("[ARES] fl_client: resuming from global_model.pt")
            return YOLO(global_path)
        print("[ARES] fl_client: no global_model.pt found, starting from best.pt")
        return YOLO(base_path)
    
    def get_parameters(self, config):
        """Server asks: what are your current weights?"""
        return get_weights(self.model)
    
    def fit(self, parameters, config):
        """
        Server says: here are the global weights, train on your local data.
        1. Load global weights
        2. Run detection on local footage (simulates local training)
        3. Return updated weights
        """
        if parameters:                        
            set_weights(self.model, parameters)


        set_weights(self.model, parameters)
        
        print(f"\n[Client {self.client_id}] Starting local training...")
        
        # Run detection on this client's footage
        # In real FL, this would be actual model training
        # For our prototype, detection on local footage simulates it
        alerts = process_video(self.footage_path, f"client{self.client_id}")
        
        # Simulate loss improving over rounds
        self.local_loss = max(0.1, self.local_loss * 0.85)
        
        num_samples = max(1, len(alerts))
        
        return get_weights(self.model), num_samples, {
            "loss":      self.local_loss,
            "client_id": float(self.client_id),
            "detections": float(len(alerts))
        }
    
    def evaluate(self, parameters, config):
        """Server asks: how accurate is the global model on your data?"""
        set_weights(self.model, parameters)
        
        # Simulate accuracy improving over rounds
        accuracy = min(0.95, 0.70 + (1 - self.local_loss) * 0.25)
        
        return self.local_loss, 1, {"accuracy": accuracy}


if __name__ == "__main__":
    # Run as: python fl_client.py 0 footage/client1/video.mp4
    client_id    = int(sys.argv[1])   if len(sys.argv) > 1 else 0
    footage_path = sys.argv[2]        if len(sys.argv) > 2 else f"footage/client{client_id+1}/sample.mp4"
    
    print(f"\nStarting Client {client_id}...")
    print(f"Connecting to FL server at localhost:8080...")
    
    fl.client.start_numpy_client(
        server_address="localhost:8089",
        client=ARESClient(client_id, footage_path)
    )