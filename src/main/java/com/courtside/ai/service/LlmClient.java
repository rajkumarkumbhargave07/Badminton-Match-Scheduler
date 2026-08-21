package com.courtside.ai.service;

import com.courtside.ai.config.LlmProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

import static org.springframework.http.HttpStatus.BAD_GATEWAY;
import static org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE;

@Service
public class LlmClient {

  private final LlmProperties properties;
  private final RestClient restClient;
  private final ObjectMapper objectMapper;

  public LlmClient(LlmProperties properties, ObjectMapper objectMapper) {
    this.properties = properties;
    this.objectMapper = objectMapper;
    this.restClient = RestClient.builder()
        .baseUrl(properties.baseUrl())
        .requestFactory(requestFactory(properties.timeoutSeconds()))
        .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
        .build();
  }

  public String generate(String prompt) {
    return generate(prompt, "You respond with concise badminton session insights.");
  }

  public String generate(String prompt, String systemInstruction) {
    return generate(prompt, systemInstruction, false);
  }

  public String generateJson(String prompt, String systemInstruction) {
    return generate(prompt, systemInstruction, true);
  }

  private String generate(String prompt, String systemInstruction, boolean jsonResponse) {
    String apiKey = normalize(properties.apiKey());

    if (apiKey.isBlank()) {
      throw new ResponseStatusException(
          SERVICE_UNAVAILABLE,
          "GEMINI_API_KEY is not configured on the server."
      );
    }

    Map<String, Object> generationConfig = jsonResponse
        ? Map.of(
            "maxOutputTokens", 8192,
            "responseMimeType", "application/json",
            "thinkingConfig", Map.of("thinkingLevel", "low")
        )
        : Map.of(
            "maxOutputTokens", 500,
            "thinkingConfig", Map.of("thinkingLevel", "low")
        );

    Map<String, Object> body = Map.of(
        "systemInstruction", Map.of(
            "parts", new Object[] {
                Map.of("text", systemInstruction)
            }
        ),
        "contents", new Object[] {
            Map.of(
                "role", "user",
                "parts", new Object[] {
                    Map.of("text", prompt)
                }
            )
        },
        "generationConfig", generationConfig,
        "safetySettings", new Object[] {}
    );

    try {
      RestClient.RequestBodySpec request = restClient.post()
          .uri("/models/{model}:generateContent", properties.model())
          .header("X-goog-api-key", apiKey)
          .body(body);

      JsonNode response = request.retrieve()
          .body(JsonNode.class);

      return extractText(response);
    } catch (ResponseStatusException e) {
      throw e;
    } catch (RestClientResponseException e) {
      throw new ResponseStatusException(BAD_GATEWAY, "Gemini API error: " + trim(e.getResponseBodyAsString()), e);
    } catch (Exception e) {
      throw new ResponseStatusException(BAD_GATEWAY, "LLM request failed.", e);
    }
  }

  private String trim(String value) {
    if (value == null || value.isBlank()) {
      return "No response body.";
    }
    String compact = value.replaceAll("\\s+", " ").trim();
    return compact.length() > 500 ? compact.substring(0, 500) + "..." : compact;
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim();
  }

  private JdkClientHttpRequestFactory requestFactory(int timeoutSeconds) {
    HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(timeoutSeconds))
        .build();
    JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
    factory.setReadTimeout(Duration.ofSeconds(timeoutSeconds));
    return factory;
  }

  private String extractText(JsonNode response) {
    if (response == null) {
      throw new ResponseStatusException(BAD_GATEWAY, "LLM returned an empty response.");
    }

    JsonNode candidates = response.get("candidates");
    if (candidates != null && candidates.isArray()) {
      StringBuilder text = new StringBuilder();
      for (JsonNode candidate : candidates) {
        JsonNode parts = candidate.path("content").path("parts");
        if (!parts.isArray()) {
          continue;
        }
        for (JsonNode part : parts) {
          JsonNode partText = part.get("text");
          if (partText != null && partText.isTextual()) {
            text.append(partText.asText()).append(System.lineSeparator());
          }
        }
      }
      String extracted = text.toString().trim();
      if (!extracted.isBlank()) {
        return extracted;
      }
    }

    try {
      return objectMapper.writeValueAsString(response);
    } catch (Exception e) {
      throw new ResponseStatusException(BAD_GATEWAY, "Could not parse LLM response.", e);
    }
  }
}
