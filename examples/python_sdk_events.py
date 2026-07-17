from suha_sdk import SuhaClient, SuhaConnectionError


def main() -> None:
    try:
        with SuhaClient("http://127.0.0.1:8200", timeout=5.0) as client:
            for event in client.events(categories=["INTENT", "GESTURE_DYNAMIC"]):
                print(event.timestamp, event.event_code, event.intent, f"{event.confidence:.0%}")
    except SuhaConnectionError as error:
        print(f"SuhaAI Core connection failed: {error}")


if __name__ == "__main__":
    main()
