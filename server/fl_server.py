# server/fl_server.py
import flwr as fl
import numpy as np
from typing import List, Tuple, Dict, Optional
from flwr.common import Metrics
from stackelberg import StackelbergScheduler
import json, os

NUM_CLIENTS = 3
NUM_ROUNDS  = 5

scheduler = StackelbergScheduler(num_clients=NUM_CLIENTS)
round_history = []

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def weighted_average(metrics: List[Tuple[int, Metrics]]) -> Metrics:
    total_samples = sum(n for n, _ in metrics)
    weighted_acc  = sum(m.get("accuracy", 0) * n for n, m in metrics)
    avg_accuracy  = weighted_acc / total_samples if total_samples > 0 else 0
    return {"accuracy": avg_accuracy}


class ARESStrategy(fl.server.strategy.FedAvg):

    def __init__(self):
        super().__init__(
            fraction_fit=0.8,
            fraction_evaluate=0.5,
            min_fit_clients=2,
            min_evaluate_clients=1,
            min_available_clients=2,
            evaluate_metrics_aggregation_fn=weighted_average,
        )
        self.current_round = 0
        self.global_loss   = 1.0

    def aggregate_fit(self, server_round, results, failures):
        self.current_round = server_round

        if not results:
            print(f"Round {server_round}: No results received!")
            return None, {}

        print(f"\n{'='*50}")
        print(f"Round {server_round}/{NUM_ROUNDS} — Aggregating {len(results)} clients")

        # Standard FedAvg aggregation
        aggregated = super().aggregate_fit(server_round, results, failures)

        # Update reputation for each contributing client
        for _, fit_res in results:
            client_loss = fit_res.metrics.get("loss", 1.0)
            client_id   = fit_res.metrics.get("client_id", 0)
            scheduler.update_reputation(
                client_id   = int(client_id),
                loss_before = self.global_loss,
                loss_after  = client_loss
            )
            self.global_loss = client_loss

        # Save global model after every round
        if aggregated is not None:
            try:
                import flwr.common
                import torch
                from ultralytics import YOLO

                global_path   = os.path.join(BASE_DIR, "model", "global_model.pt")
                fallback_path = os.path.join(BASE_DIR, "model", "best.pt")
                checkpoint    = global_path if os.path.exists(global_path) else fallback_path

                if checkpoint == global_path:
                    print(f"  ↻ Building on existing global_model.pt")
                else:
                    print(f"  ↻ First round — initialising from best.pt")

                global_model = YOLO(checkpoint)                                   # ← fixed
                parameters   = aggregated[0]
                weights      = flwr.common.parameters_to_ndarrays(parameters)

                for param, weight in zip(global_model.model.parameters(), weights):
                    param.data = torch.tensor(weight)

                save_path = os.path.join(BASE_DIR, "model", "global_model.pt")
                global_model.save(save_path)
                print(f"✅ Global model saved → model/global_model.pt (Round {server_round})")

            except Exception as e:
                print(f"⚠️ Could not save global model: {e}")

        print(f"Round {server_round} aggregation complete ✅")
        return aggregated

    def aggregate_evaluate(self, server_round, results, failures):
        loss, metrics = super().aggregate_evaluate(server_round, results, failures)

        if metrics:
            accuracy = metrics.get("accuracy", 0)
            round_history.append({
                "round":    server_round,
                "accuracy": round(accuracy * 100, 2),
                "loss":     round(float(loss) if loss else 0, 4)
            })
            print(f"Round {server_round} — Global Accuracy: {accuracy*100:.1f}%")

            os.makedirs(os.path.join(BASE_DIR, "outputs"), exist_ok=True)
            with open(os.path.join(BASE_DIR, "outputs", "training_history.json"), "w") as f:
                json.dump(round_history, f)

        return loss, metrics


if __name__ == "__main__":
    print("\n" + "="*50)
    print("  A.R.E.S Federated Learning Server Starting")
    print("="*50)
    print(f"Waiting for {NUM_CLIENTS} clients to connect...")
    print("(Start your client terminals now)\n")

    fl.server.start_server(
        server_address="0.0.0.0:8089",
        config=fl.server.ServerConfig(num_rounds=NUM_ROUNDS),
        strategy=ARESStrategy()
    )

    print("\n✅ Federated Learning Complete!")
    print(f"Global model saved at: model/global_model.pt")
    print(f"Training history saved to outputs/training_history.json")