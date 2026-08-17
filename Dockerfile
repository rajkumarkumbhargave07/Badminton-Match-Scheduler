FROM maven:3.9.9-eclipse-temurin-21 AS build

WORKDIR /app

COPY pom.xml .
RUN mvn -B dependency:go-offline

COPY src ./src
RUN mvn -B clean package -DskipTests

FROM eclipse-temurin:21-jre

WORKDIR /app

RUN addgroup --system courtside && adduser --system --ingroup courtside courtside

COPY --from=build /app/target/*.jar app.jar

USER courtside

EXPOSE 8000

ENTRYPOINT ["java", "-jar", "app.jar"]
