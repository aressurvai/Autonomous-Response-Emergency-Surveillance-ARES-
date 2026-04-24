# server/stackelberg.py
import numpy as np

class StackelbergScheduler:
    
    def __init__(self, num_clients):
        self.num_clients = num_clients
        
        # Reputation starts at 0.5 for everyone (neutral)
        # Goes up when a client contributes good updates
        # Goes down when a client contributes bad/no updates
        self.reputation = np.ones(num_clients) * 0.5
        
        # Track how many rounds each client has participated
        self.rounds_participated = np.zeros(num_clients)
        
        print(f"Stackelberg Scheduler initialized for {num_clients} clients")
    
    def select_clients(self, round_num):
        """
        Returns list of client IDs that should participate this round.
        Always selects at least 2 clients.
        """
        # Clients with higher reputation get higher priority
        # Add small random noise so it's not always the same clients
        scores = self.reputation + np.random.uniform(0, 0.1, self.num_clients)
        
        # Always select at least 2, max all clients
        n_select = max(2, int(self.num_clients * 0.8))
        
        # Pick the top scoring clients
        selected = np.argsort(scores)[-n_select:].tolist()
        
        print(f"\n[Stackelberg] Round {round_num}: Selected clients {selected}")
        print(f"[Stackelberg] Reputations: {self.reputation.round(3)}")
        
        return selected
    
    def update_reputation(self, client_id, loss_before, loss_after):
        """
        Update a client's reputation based on how much they improved the model.
        If their update reduced the loss — good contribution, reputation goes up.
        If their update made things worse — reputation goes down.
        """
        improvement = loss_before - loss_after
        
        if improvement > 0:
            # Good contribution
            self.reputation[client_id] = min(1.0, self.reputation[client_id] + 0.1)
        else:
            # Bad contribution
            self.reputation[client_id] = max(0.1, self.reputation[client_id] - 0.05)
        
        self.rounds_participated[client_id] += 1
        print(f"[Stackelberg] Client {client_id} reputation updated to {self.reputation[client_id]:.3f}")
    
    def get_status(self):
        """Returns current reputation scores for all clients."""
        return {
            f"client_{i}": {
                "reputation": round(float(self.reputation[i]), 3),
                "rounds_participated": int(self.rounds_participated[i])
            }
            for i in range(self.num_clients)
        }